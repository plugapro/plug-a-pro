// ─── Admin: Reports dashboard ──────────────────────────────────────────────────
// Read-only stats: KPI cards, top categories, provider performance.

export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = buildMetadata({ title: 'Reports', noIndex: true })

// ─── KPI Card component ───────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  delta,
}: {
  label: string
  value: string | number
  sub?: string
  delta?: { current: number; previous: number; unit?: string }
}) {
  const change =
    delta && delta.previous > 0
      ? ((delta.current - delta.previous) / delta.previous) * 100
      : null

  return (
    <Card>
      <CardContent className="p-5 space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        {change !== null && (
          <p className={`text-xs font-medium ${change >= 0 ? 'text-[var(--tone-success-fg)]' : 'text-[var(--tone-danger-fg)]'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs last month
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ReportsPage() {
  await requireAdmin()

  const now            = new Date()
  const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 1)

  // ── Parallel data fetches ─────────────────────────────────────────────────

  const [
    bookingsThisMonth,
    bookingsLastMonth,
    paymentsThisMonth,
    paymentsLastMonth,
    jobsCompletedThisMonth,
    allActiveBookingsThisMonth,
    topCategories,
    providers,
  ] = await Promise.all([
    // Bookings this month
    db.booking.count({
      where: { createdAt: { gte: monthStart }, match: { jobRequest: { isTestRequest: false } } },
    }),
    // Bookings last month
    db.booking.count({
      where: {
        createdAt: { gte: lastMonthStart, lt: lastMonthEnd },
        match: { jobRequest: { isTestRequest: false } },
      },
    }),
    // PAID payments this month (revenue)
    db.payment.aggregate({
      where: {
        status: 'PAID',
        paidAt: { gte: monthStart },
        booking: { match: { jobRequest: { isTestRequest: false } } },
      },
      _sum: { amount: true },
    }),
    // PAID payments last month
    db.payment.aggregate({
      where: {
        status: 'PAID',
        paidAt: { gte: lastMonthStart, lt: lastMonthEnd },
        booking: { match: { jobRequest: { isTestRequest: false } } },
      },
      _sum: { amount: true },
    }),
    // Jobs completed this month
    db.job.count({
      where: {
        status:      'COMPLETED',
        isTestJob: false,
        completedAt: { gte: monthStart },
      },
    }),
    // For conversion rate: COMPLETED + SCHEDULED + RESCHEDULED this month
    db.booking.findMany({
      where: {
        createdAt: { gte: monthStart },
        status:    { in: ['COMPLETED', 'SCHEDULED', 'RESCHEDULED'] },
        match: { jobRequest: { isTestRequest: false } },
      },
      select: { status: true },
    }),
    // Top categories by job request count this month
    db.jobRequest.groupBy({
      by:      ['category'],
      where:   { createdAt: { gte: monthStart }, isTestRequest: false },
      _count:  { category: true },
      orderBy: { _count: { category: 'desc' } },
      take: 8,
    }),
    // Provider performance
    db.provider.findMany({
      where:  { active: true, isTestUser: false },
      select: {
        id:   true,
        name: true,
        jobs: {
          where:  { status: 'COMPLETED', isTestJob: false, completedAt: { gte: monthStart } },
          select: { id: true },
        },
      },
    }),
  ])

  // ── Revenue numbers ───────────────────────────────────────────────────────

  const revenueThisMonth = Number(paymentsThisMonth._sum.amount ?? 0)
  const revenueLastMonth = Number(paymentsLastMonth._sum.amount ?? 0)

  // ── Conversion rate ───────────────────────────────────────────────────────

  const completedCount      = allActiveBookingsThisMonth.filter((b) => b.status === 'COMPLETED').length
  const totalConversionBase = allActiveBookingsThisMonth.length
  const conversionRate      = totalConversionBase > 0
    ? (completedCount / totalConversionBase) * 100
    : 0

  // ── Provider ratings ──────────────────────────────────────────────────────

  const providerJobIds = providers.flatMap((p) => p.jobs.map((j) => j.id))
  const jobReviews = await db.review.findMany({
    where: { jobId: { in: providerJobIds } },
    select: { jobId: true, score: true },
  })
  const reviewByJob = Object.fromEntries(jobReviews.map((r) => [r.jobId, r.score]))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {now.toLocaleString('en-ZA', { month: 'long', year: 'numeric' })} - month to date
        </p>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label="Bookings"
          value={bookingsThisMonth}
          delta={{ current: bookingsThisMonth, previous: bookingsLastMonth }}
        />
        <KpiCard
          label="Revenue"
          value={`R ${revenueThisMonth.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`}
          delta={{ current: revenueThisMonth, previous: revenueLastMonth }}
        />
        <KpiCard
          label="Jobs Completed"
          value={jobsCompletedThisMonth}
        />
        <KpiCard
          label="Conversion"
          value={`${conversionRate.toFixed(0)}%`}
          sub={`${completedCount} of ${totalConversionBase} active`}
        />
        <KpiCard
          label="Last Month Rev"
          value={`R ${revenueLastMonth.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`}
        />
        <KpiCard
          label="Active Providers"
          value={providers.length}
        />
      </div>

      {/* ── Tables ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top Categories */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Top Categories This Month</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Job Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topCategories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                      No data for this period
                    </TableCell>
                  </TableRow>
                )}
                {topCategories.map((cat) => (
                  <TableRow key={cat.category}>
                    <TableCell>{cat.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{cat._count.category}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        {/* Provider Performance */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Provider Performance This Month</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Jobs Done</TableHead>
                  <TableHead className="text-right">Avg Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No providers found
                    </TableCell>
                  </TableRow>
                )}
                {providers
                  .sort((a, b) => b.jobs.length - a.jobs.length)
                  .map((provider) => {
                    const scores = provider.jobs
                      .map((j) => reviewByJob[j.id])
                      .filter((s): s is number => s !== undefined)
                    const avgRating =
                      scores.length > 0
                        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
                        : null

                    return (
                      <TableRow key={provider.id}>
                        <TableCell>{provider.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{provider.jobs.length}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {avgRating ? `${avgRating} / 5` : '-'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </div>
  )
}
