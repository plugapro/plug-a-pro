// ─── Admin: Provider Quality view ─────────────────────────────────────────────
// Founder-facing snapshot of provider quality readiness + a one-click
// dry-run nudge preview.
// Reads only. Sends go through actions.ts → sendNudgesAction (flag-gated).

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { getQualityCounts, loadProviderQualityRows, type QualityFilter } from '@/lib/provider-quality/queries'
import { previewNudges, QUALITY_UPLIFT_FLAG } from '@/lib/provider-quality/orchestrator'
import { QUALITY_DIMENSION_LABEL, type QualityDimension } from '@/lib/provider-quality/quality'
import { Badge } from '@/components/ui/badge'

type SearchParams = Record<string, string | string[] | undefined>

function readBool(searchParams: SearchParams, key: string): boolean {
  const v = searchParams[key]
  if (Array.isArray(v)) return v[0] === '1' || v[0] === 'true'
  return v === '1' || v === 'true'
}

function buildFilter(searchParams: SearchParams): QualityFilter {
  return {
    missingKyc: readBool(searchParams, 'missingKyc'),
    missingProfilePhoto: readBool(searchParams, 'missingProfilePhoto'),
    missingPortfolioEvidence: readBool(searchParams, 'missingPortfolioEvidence'),
    missingHighRiskCert: readBool(searchParams, 'missingHighRiskCert'),
    hasHighRiskSkill: readBool(searchParams, 'hasHighRiskSkill'),
    notQualityReady: readBool(searchParams, 'notQualityReady'),
    kycStartedIncomplete: readBool(searchParams, 'kycStartedIncomplete'),
    kycFailedOrExpired: readBool(searchParams, 'kycFailedOrExpired'),
  }
}

function FilterChip({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-xs border ${
        active
          ? 'bg-foreground text-background border-foreground'
          : 'bg-background text-foreground border-border hover:bg-muted'
      }`}
    >
      {label}
    </Link>
  )
}

function ratio(num: number, denom: number) {
  if (denom === 0) return '0%'
  return `${Math.round((num / denom) * 100)}%`
}

function lastNudgeLabel(value: Date | null) {
  if (!value) return '—'
  const diffMs = Date.now() - value.getTime()
  const diffH = Math.floor(diffMs / (60 * 60 * 1000))
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}

function buildLink(current: SearchParams, key: string, on: boolean): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) {
    if (k === key) continue
    if (typeof v === 'string') params.set(k, v)
  }
  if (on) params.set(key, '1')
  const qs = params.toString()
  return qs ? `/admin/quality?${qs}` : '/admin/quality'
}

export default async function ProviderQualityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  await requireAdmin()
  const resolved = await searchParams
  const filter = buildFilter(resolved)
  const [counts, rows, preview, flagEnabled] = await Promise.all([
    getQualityCounts(),
    loadProviderQualityRows({ ...filter, limit: 250 }),
    previewNudges(filter),
    isEnabled(QUALITY_UPLIFT_FLAG).catch(() => false),
  ])

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Provider Quality</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Baseline of provider readiness across KYC, profile photo, evidence of
            work, and high-risk-skill certification.{' '}
            <span className="font-medium">
              {counts.qualityReady} of {counts.totalProviders} quality-ready (
              {ratio(counts.qualityReady, counts.totalProviders)}).
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={flagEnabled ? 'default' : 'secondary'}>
            {flagEnabled ? 'Send: enabled' : 'Send: disabled'}
          </Badge>
          <Badge variant="outline">Dry-run preview: always on</Badge>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="KYC verified" value={`${counts.kycVerified} / ${counts.totalProviders}`} sub={ratio(counts.kycVerified, counts.totalProviders)} />
        <Stat label="Profile photo" value={`${counts.withProfilePhoto} / ${counts.totalProviders}`} sub={ratio(counts.withProfilePhoto, counts.totalProviders)} />
        <Stat label="Portfolio evidence" value={`${counts.withPortfolioEvidence} / ${counts.totalProviders}`} sub={ratio(counts.withPortfolioEvidence, counts.totalProviders)} />
        <Stat label="High-risk providers" value={`${counts.highRiskProviders}`} sub={`${counts.highRiskMissingCert} missing cert`} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Filters</h2>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={!!filter.missingKyc} href={buildLink(resolved, 'missingKyc', !filter.missingKyc)} label="Missing KYC" />
          <FilterChip active={!!filter.missingProfilePhoto} href={buildLink(resolved, 'missingProfilePhoto', !filter.missingProfilePhoto)} label="Missing profile photo" />
          <FilterChip active={!!filter.missingPortfolioEvidence} href={buildLink(resolved, 'missingPortfolioEvidence', !filter.missingPortfolioEvidence)} label="Missing evidence" />
          <FilterChip active={!!filter.missingHighRiskCert} href={buildLink(resolved, 'missingHighRiskCert', !filter.missingHighRiskCert)} label="High-risk: missing cert" />
          <FilterChip active={!!filter.hasHighRiskSkill} href={buildLink(resolved, 'hasHighRiskSkill', !filter.hasHighRiskSkill)} label="Has high-risk skill" />
          <FilterChip active={!!filter.notQualityReady} href={buildLink(resolved, 'notQualityReady', !filter.notQualityReady)} label="Not quality-ready" />
          <FilterChip active={!!filter.kycStartedIncomplete} href={buildLink(resolved, 'kycStartedIncomplete', !filter.kycStartedIncomplete)} label="KYC started, incomplete" />
          <FilterChip active={!!filter.kycFailedOrExpired} href={buildLink(resolved, 'kycFailedOrExpired', !filter.kycFailedOrExpired)} label="KYC failed/expired" />
        </div>
      </section>

      <section className="rounded-md border">
        <div className="px-4 py-2 border-b flex items-center justify-between bg-muted/30 text-xs">
          <span>{rows.length} provider(s) match</span>
          <span>
            Nudge preview: <strong>{preview.totalSendable}</strong> sendable,{' '}
            <strong>{preview.totalBlocked}</strong> blocked
            {!flagEnabled && <span className="ml-2 text-amber-700">(send disabled by flag)</span>}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Skills</th>
                <th className="px-3 py-2">Quality</th>
                <th className="px-3 py-2">KYC</th>
                <th className="px-3 py-2">Photo</th>
                <th className="px-3 py-2">Evidence</th>
                <th className="px-3 py-2">Cert (HR)</th>
                <th className="px-3 py-2">Missing</th>
                <th className="px-3 py-2">Last nudge</th>
                <th className="px-3 py-2">Recommended</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tail4 = r.provider.phone?.slice(-4) ?? '—'
                const highRiskBadge = r.snapshot.hasHighRiskSkill ? (
                  <Badge variant="outline" className="mr-1 text-amber-700 border-amber-300">HR</Badge>
                ) : null
                const recommended =
                  r.snapshot.recommendedNudge != null
                    ? QUALITY_DIMENSION_LABEL[r.snapshot.recommendedNudge as QualityDimension]
                    : '—'
                return (
                  <tr key={r.provider.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.provider.name ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">…{tail4}</td>
                    <td className="px-3 py-2">
                      {highRiskBadge}
                      <span className="text-xs text-muted-foreground">{r.provider.skills.join(', ')}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.snapshot.isQualityReady ? (
                        <Badge>Quality-ready</Badge>
                      ) : (
                        <Badge variant="secondary">Not ready</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{statusBadge(r.snapshot.dimensions.kyc)}</td>
                    <td className="px-3 py-2">{statusBadge(r.snapshot.dimensions.profile_photo)}</td>
                    <td className="px-3 py-2">{statusBadge(r.snapshot.dimensions.portfolio_evidence)}</td>
                    <td className="px-3 py-2">{statusBadge(r.snapshot.dimensions.high_risk_cert)}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.snapshot.missingItems.length
                        ? r.snapshot.missingItems.map((d) => QUALITY_DIMENSION_LABEL[d]).join('; ')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {lastNudgeLabel(r.lastNudgeAt)}
                      {r.nudgeCount > 0 && (
                        <span className="text-muted-foreground"> ({r.nudgeCount})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{recommended}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-4 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  )
}

function statusBadge(state: string) {
  switch (state) {
    case 'PRESENT':
      return <Badge>✓</Badge>
    case 'NOT_APPLICABLE':
      return <span className="text-xs text-muted-foreground">n/a</span>
    case 'IN_PROGRESS':
      return <Badge variant="outline">started</Badge>
    case 'NEEDS_REVIEW':
      return <Badge variant="outline">review</Badge>
    case 'FAILED':
      return <Badge variant="destructive">failed</Badge>
    case 'MISSING':
    default:
      return <Badge variant="secondary">—</Badge>
  }
}
