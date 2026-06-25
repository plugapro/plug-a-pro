// Admin customer-funnel report — Tier 1.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// Aggregate-only view: counts + category/suburb labels + notification health.
// No customer PII surfaces here. Date-filterable via ?range=24h|7d|30d|custom
// with optional ?from/?to (ISO 8601) for custom ranges.

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  biggestLeak,
  fetchFunnelByService,
  fetchFunnelBySuburb,
  fetchFunnelCounts,
  fetchNotificationHealth,
  type FunnelCounts,
} from '@/lib/admin/funnel-aggregate'

export const metadata = buildMetadata({ title: 'Customer Funnel Report', noIndex: true })

type RangePreset = '24h' | '7d' | '30d' | 'custom'
const DEFAULT_RANGE: RangePreset = '7d'

function resolveRange(searchParams: Record<string, string | string[] | undefined>) {
  const presetRaw = Array.isArray(searchParams.range) ? searchParams.range[0] : searchParams.range
  const preset: RangePreset =
    presetRaw === '24h' || presetRaw === '7d' || presetRaw === '30d' || presetRaw === 'custom'
      ? presetRaw
      : DEFAULT_RANGE

  const now = new Date()
  if (preset === 'custom') {
    const fromRaw = Array.isArray(searchParams.from) ? searchParams.from[0] : searchParams.from
    const toRaw = Array.isArray(searchParams.to) ? searchParams.to[0] : searchParams.to
    const from = fromRaw ? new Date(fromRaw) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const to = toRaw ? new Date(toRaw) : now
    return { preset, from, to }
  }
  const hours = preset === '24h' ? 24 : preset === '30d' ? 24 * 30 : 24 * 7
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000)
  return { preset, from, to: now }
}

function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '—'
  return `${Math.round(ratio * 100)}%`
}

function rangeHref(preset: RangePreset): string {
  return preset === 'custom' ? '/admin/reports/funnel?range=custom' : `/admin/reports/funnel?range=${preset}`
}

const STAGE_LABEL: Record<keyof FunnelCounts, string> = {
  started: 'Request started',
  submitted: 'Request submitted',
  matchAttempted: 'Match attempted',
  matchedToProvider: '≥1 eligible provider',
  providerAccepted: 'Provider accepted',
  clientNotified: 'Client notified',
}

export default async function CustomerFunnelReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()
  const flagOn = await isEnabled('admin.reports.customer_funnel').catch(() => false)
  if (!flagOn) notFound()

  const sp = await searchParams
  const { preset, from, to } = resolveRange(sp)

  const [counts, byService, bySuburb, notif] = await Promise.all([
    fetchFunnelCounts({ from, to }),
    fetchFunnelByService({ from, to }, undefined, 10),
    fetchFunnelBySuburb({ from, to }, undefined, 10),
    fetchNotificationHealth({ from, to }),
  ])

  const leak = biggestLeak(counts)
  const stages: Array<keyof FunnelCounts> = [
    'started',
    'submitted',
    'matchAttempted',
    'matchedToProvider',
    'providerAccepted',
    'clientNotified',
  ]

  return (
    <div className="space-y-8">
      {/* TODO(tier-2): WorkflowEvent has no isTestEvent column. WorkflowEvent-based
          stage counts (REQUEST_STARTED, PROVIDER_ACCEPTED, CLIENT_NOTIFIED) include
          test-cohort traffic, while JobRequest counts filter isTestRequest=false.
          This can cause started > submitted in windows with test activity. */}
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>Note:</strong> Test-event traffic is included in cohort-event counts
        (started / provider-accepted / client-notified) until tier-2 fix lands.
        Submitted counts already exclude test requests. Conversion rates may appear
        inflated in windows with test activity.
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/reports"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Reports
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Customer Funnel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {from.toISOString().slice(0, 10)} → {to.toISOString().slice(0, 10)} ·{' '}
            {counts.submitted} submitted
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['24h', '7d', '30d'] as const).map((p) => {
            const active = preset === p
            return (
              <Link
                key={p}
                href={rangeHref(p)}
                className={
                  'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border transition-colors ' +
                  (active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:text-foreground')
                }
              >
                {p}
              </Link>
            )
          })}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Funnel waterfall</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">vs previous</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stages.map((stage, i) => {
                const value = counts[stage]
                const prev = i === 0 ? null : counts[stages[i - 1]]
                const ratio = prev && prev > 0 ? value / prev : null
                const isLeakSource = leak?.fromStage === stage
                return (
                  <TableRow key={stage} className={isLeakSource ? 'bg-amber-50/40 dark:bg-amber-950/20' : undefined}>
                    <TableCell>{STAGE_LABEL[stage]}</TableCell>
                    <TableCell className="text-right tabular-nums">{value}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {ratio === null ? '—' : formatPct(ratio)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
        {leak && (
          <p className="text-sm text-muted-foreground">
            Biggest leak: <strong className="text-foreground">{STAGE_LABEL[leak.fromStage]} → {STAGE_LABEL[leak.toStage]}</strong>{' '}
            ({leak.dropped} dropped, {formatPct(leak.ratio)} of {STAGE_LABEL[leak.fromStage].toLowerCase()})
          </p>
        )}
      </section>

      <GroupTable title="By service" keyHeader="Service" rows={byService} />
      <GroupTable title="By suburb" keyHeader="Suburb" rows={bySuburb} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Provider notification health</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Sent</TableCell>
                <TableCell className="text-right tabular-nums">{notif.sent}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Delivered</TableCell>
                <TableCell className="text-right tabular-nums">{notif.delivered}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Read</TableCell>
                <TableCell className="text-right tabular-nums">{notif.read}</TableCell>
              </TableRow>
              <TableRow className={notif.failed > 0 ? 'bg-rose-50/40 dark:bg-rose-950/20' : undefined}>
                <TableCell>Failed</TableCell>
                <TableCell className="text-right tabular-nums">{notif.failed}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
        {notif.byTemplate.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Failed by template:{' '}
            {notif.byTemplate.map((t) => `${t.templateName} ×${t.failed}`).join(', ')}
          </p>
        )}
      </section>
    </div>
  )
}

function GroupTable({
  title,
  keyHeader,
  rows,
}: {
  title: string
  keyHeader: string
  rows: Array<{ key: string; submitted: number; accepted: number; conversionRate: number }>
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{keyHeader}</TableHead>
              <TableHead className="text-right">Submitted</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Conversion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  No data for this period
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.submitted}</TableCell>
                <TableCell className="text-right tabular-nums">{r.accepted}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.submitted > 0 ? `${Math.round(r.conversionRate * 100)}%` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}
