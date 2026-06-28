// Admin KYC funnel report.
// Snapshot of Provider.kycStatus distribution + recent verification activity.
// Behind admin.reports.kyc_funnel; 404 when off.

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
  fetchKycActivity,
  fetchKycSnapshot,
  KYC_FUNNEL_STAGES,
} from '@/lib/admin/kyc-funnel-aggregate'

export const metadata = buildMetadata({ title: 'KYC Funnel Report', noIndex: true })

type RangePreset = '24h' | '7d' | '30d'
const DEFAULT_RANGE: RangePreset = '7d'

function resolveRange(searchParams: Record<string, string | string[] | undefined>) {
  const presetRaw = Array.isArray(searchParams.range) ? searchParams.range[0] : searchParams.range
  const preset: RangePreset =
    presetRaw === '24h' || presetRaw === '7d' || presetRaw === '30d' ? presetRaw : DEFAULT_RANGE
  const now = new Date()
  const hours = preset === '24h' ? 24 : preset === '30d' ? 24 * 30 : 24 * 7
  return { preset, from: new Date(now.getTime() - hours * 60 * 60 * 1000), to: now }
}

function formatPct(num: number, denom: number): string {
  if (denom <= 0) return '—'
  return `${Math.round((num / denom) * 100)}%`
}

const STAGE_LABEL: Record<(typeof KYC_FUNNEL_STAGES)[number], string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted (vendor review)',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
}

export default async function KycFunnelReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()
  const flagOn = await isEnabled('admin.reports.kyc_funnel').catch(() => false)
  if (!flagOn) notFound()

  const sp = await searchParams
  const { preset, from, to } = resolveRange(sp)

  const [active, applicationPending, activity] = await Promise.all([
    fetchKycSnapshot({ status: 'ACTIVE' }),
    fetchKycSnapshot({ status: 'APPLICATION_PENDING' }),
    fetchKycActivity({ from, to }),
  ])

  const verifiedRate = active.total > 0 ? active.verified / active.total : 0
  const activityDecisions = activity.verifiedInWindow + activity.rejectedInWindow + activity.expiredInWindow

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/reports"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Reports
          </Link>
          <h1 className="mt-2 text-xl font-semibold">KYC Funnel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Snapshot now · activity window {from.toISOString().slice(0, 10)} → {to.toISOString().slice(0, 10)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['24h', '7d', '30d'] as const).map((p) => {
            const active = preset === p
            return (
              <Link
                key={p}
                href={`/admin/reports/kyc-funnel?range=${p}`}
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
        <h2 className="text-sm font-semibold">Active providers — snapshot</h2>
        <p className="text-xs text-muted-foreground">
          {active.total} active providers · {active.verified} verified ({formatPct(active.verified, active.total)})
          · <strong className="text-foreground">{active.activeMissingKyc}</strong> blocked from full activation by missing KYC
        </p>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">% of active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KYC_FUNNEL_STAGES.map((stage) => {
                const value =
                  stage === 'NOT_STARTED' ? active.notStarted
                  : stage === 'IN_PROGRESS' ? active.inProgress
                  : stage === 'SUBMITTED' ? active.submitted
                  : stage === 'VERIFIED' ? active.verified
                  : stage === 'REJECTED' ? active.rejected
                  : active.expired
                const isVerified = stage === 'VERIFIED'
                return (
                  <TableRow key={stage} className={isVerified ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : undefined}>
                    <TableCell>{STAGE_LABEL[stage]}</TableCell>
                    <TableCell className="text-right tabular-nums">{value}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatPct(value, active.total)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Pending applications — snapshot</h2>
        <p className="text-xs text-muted-foreground">
          {applicationPending.total} APPLICATION_PENDING providers ·{' '}
          {applicationPending.activeMissingKyc} need to complete KYC before they can be approved
        </p>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KYC_FUNNEL_STAGES.map((stage) => {
                const value =
                  stage === 'NOT_STARTED' ? applicationPending.notStarted
                  : stage === 'IN_PROGRESS' ? applicationPending.inProgress
                  : stage === 'SUBMITTED' ? applicationPending.submitted
                  : stage === 'VERIFIED' ? applicationPending.verified
                  : stage === 'REJECTED' ? applicationPending.rejected
                  : applicationPending.expired
                return (
                  <TableRow key={stage}>
                    <TableCell>{STAGE_LABEL[stage]}</TableCell>
                    <TableCell className="text-right tabular-nums">{value}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Verification activity — {preset}</h2>
        <p className="text-xs text-muted-foreground">
          {activity.newStarts} new verification rows created ·{' '}
          {activityDecisions} terminal decisions ·{' '}
          {formatPct(activity.verifiedInWindow, activityDecisions)} pass rate
        </p>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>New verification rows started (createdAt in window)</TableCell>
                <TableCell className="text-right tabular-nums">{activity.newStarts}</TableCell>
              </TableRow>
              <TableRow className="bg-emerald-50/40 dark:bg-emerald-950/20">
                <TableCell>Reached PASSED (decisionAt in window)</TableCell>
                <TableCell className="text-right tabular-nums">{activity.verifiedInWindow}</TableCell>
              </TableRow>
              <TableRow className={activity.rejectedInWindow > 0 ? 'bg-rose-50/40 dark:bg-rose-950/20' : undefined}>
                <TableCell>Reached REJECTED</TableCell>
                <TableCell className="text-right tabular-nums">{activity.rejectedInWindow}</TableCell>
              </TableRow>
              <TableRow className={activity.expiredInWindow > 0 ? 'bg-amber-50/40 dark:bg-amber-950/20' : undefined}>
                <TableCell>Reached EXPIRED</TableCell>
                <TableCell className="text-right tabular-nums">{activity.expiredInWindow}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">
          New starts include test-cohort rows. Terminal decisions reflect vendor adjudications + cron-driven EXPIRED transitions.
        </p>
      </section>

      <section className="space-y-3 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">Overall verified rate</strong> across active providers:{' '}
          {formatPct(active.verified, active.total)}. Use this as the threshold readout when deciding whether to retire{' '}
          <code className="rounded bg-muted px-1">matching.kyc_grace_legacy_providers</code>.
        </p>
      </section>
    </div>
  )
}
