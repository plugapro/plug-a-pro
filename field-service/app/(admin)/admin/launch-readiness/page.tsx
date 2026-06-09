// ─── Admin: West Rand pilot launch readiness ──────────────────────────────
// Read-only operational readiness view. Counts approved providers per
// (suburb × category), surfaces electrical-readiness state, and warns on
// thin-coverage categories. Gated by launch.west_rand_pilot.readiness_report.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { loadLaunchReadiness } from '@/lib/launch/readiness-counts'
import { WEST_RAND_PILOT } from '@/lib/launch/west-rand-pilot'
import { buildMetadata } from '@/lib/metadata'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Launch readiness', noIndex: true })

function ElectricalBanner({
  electrical,
}: {
  electrical: { ready: boolean; approvedCount: number; threshold: number; shortfall: number }
}) {
  if (electrical.ready) {
    return (
      <Card className="border-[var(--tone-success-border)] bg-[var(--tone-success-bg)]">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-[var(--tone-success-fg)]">
            Electrical is launch-ready ({electrical.approvedCount}/{electrical.threshold} providers).
          </p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className="border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)]">
      <CardContent className="p-4 space-y-1">
        <p className="text-sm font-semibold text-[var(--tone-danger-fg)]">
          Electrical is not launch-ready
        </p>
        <p className="text-sm text-[var(--tone-danger-fg)]">
          Need {electrical.shortfall} more approved provider{electrical.shortfall === 1 ? '' : 's'}{' '}
          before enabling. Currently: {electrical.approvedCount}/{electrical.threshold}.
        </p>
      </CardContent>
    </Card>
  )
}

function ThinCoverageBanner({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null
  return (
    <Card className="border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)]">
      <CardContent className="p-4 space-y-1">
        <p className="text-sm font-semibold text-[var(--tone-warning-fg)]">
          Thin coverage ({categories.length})
        </p>
        <p className="text-sm text-[var(--tone-warning-fg)]">
          Fewer than 3 approved providers for: {categories.join(', ')}.
        </p>
      </CardContent>
    </Card>
  )
}

export default async function LaunchReadinessPage() {
  await requireAdmin()
  const enabled = await isEnabled('launch.west_rand_pilot.readiness_report')
  if (!enabled) {
    notFound()
  }

  const readiness = await loadLaunchReadiness()

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{WEST_RAND_PILOT.label} — launch readiness</h1>
        <p className="text-sm text-muted-foreground">
          {WEST_RAND_PILOT.activeSuburbSlugs.length} suburbs · {WEST_RAND_PILOT.allowedCategorySlugs.length} categories ·{' '}
          electrical threshold {WEST_RAND_PILOT.electricalThreshold}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <ElectricalBanner electrical={readiness.electrical} />
        <ThinCoverageBanner categories={readiness.thinCoverageCategories} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tier breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {readiness.tierBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers to classify yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {readiness.tierBreakdown.map((t) => (
                <Badge key={t.tier} variant="outline">
                  {t.tier}: {t.count}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approved providers by suburb &amp; category</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Suburb</TableHead>
                {WEST_RAND_PILOT.allowedCategorySlugs.map((slug) => (
                  <TableHead key={slug} className="text-right capitalize">
                    {slug}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {WEST_RAND_PILOT.activeSuburbSlugs.map((suburbSlug) => {
                const row = readiness.suburbCategoryCounts.filter(
                  (r) => r.suburbSlug === suburbSlug,
                )
                const label = row[0]?.suburbLabel ?? suburbSlug
                return (
                  <TableRow key={suburbSlug}>
                    <TableCell className="font-medium">{label}</TableCell>
                    {WEST_RAND_PILOT.allowedCategorySlugs.map((categorySlug) => {
                      const cell = row.find((r) => r.categorySlug === categorySlug)
                      const count = cell?.approvedProviderCount ?? 0
                      return (
                        <TableCell
                          key={categorySlug}
                          className={`text-right ${count === 0 ? 'text-muted-foreground' : ''}`}
                        >
                          {count}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
