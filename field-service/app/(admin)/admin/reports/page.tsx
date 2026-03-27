// ─── Admin: Reports dashboard ──────────────────────────────────────────────────
// Read-only stats: KPI cards, top services, technician performance.

export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireAdmin, resolveBusinessId } from '@/lib/auth'
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
          <p className={`text-xs font-medium ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
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
  const businessId = await resolveBusinessId()

  const now           = new Date()
  const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd  = new Date(now.getFullYear(), now.getMonth(), 1)

  // ── Parallel data fetches ─────────────────────────────────────────────────

  const [
    bookingsThisMonth,
    bookingsLastMonth,
    paymentsThisMonth,
    paymentsLastMonth,
    jobsCompletedThisMonth,
    ratingsThisMonth,
    allActiveBookingsThisMonth,
    topServices,
    technicians,
  ] = await Promise.all([
    // Bookings this month
    db.booking.count({
      where: { businessId, createdAt: { gte: monthStart } },
    }),
    // Bookings last month
    db.booking.count({
      where: { businessId, createdAt: { gte: lastMonthStart, lt: lastMonthEnd } },
    }),
    // PAID payments this month (revenue)
    db.payment.aggregate({
      where: {
        status:  'PAID',
        paidAt:  { gte: monthStart },
        booking: { businessId },
      },
      _sum: { amount: true },
    }),
    // PAID payments last month
    db.payment.aggregate({
      where: {
        status:  'PAID',
        paidAt:  { gte: lastMonthStart, lt: lastMonthEnd },
        booking: { businessId },
      },
      _sum: { amount: true },
    }),
    // Jobs completed this month
    db.job.count({
      where: {
        status:      'COMPLETED',
        completedAt: { gte: monthStart },
        booking:     { businessId },
      },
    }),
    // Average rating for bookings this month
    db.rating.aggregate({
      where: {
        booking: { businessId, createdAt: { gte: monthStart } },
      } as Parameters<typeof db.rating.aggregate>[0]['where'],
      _avg: { score: true },
    }),
    // For conversion rate: COMPLETED + CONFIRMED + SCHEDULED this month
    db.booking.findMany({
      where: {
        businessId,
        createdAt: { gte: monthStart },
        status:    { in: ['COMPLETED', 'CONFIRMED', 'SCHEDULED'] },
      },
      select: { status: true },
    }),
    // Top services by booking count this month
    db.booking.groupBy({
      by:    ['serviceId'],
      where: { businessId, createdAt: { gte: monthStart } },
      _count: { serviceId: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: 5,
    }),
    // Technician performance
    db.technician.findMany({
      where: { businessId, active: true },
      select: {
        id:   true,
        name: true,
        jobs: {
          where:  { status: 'COMPLETED', completedAt: { gte: monthStart } },
          select: {
            id: true,
            booking: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
  ])

  // ── Revenue numbers ───────────────────────────────────────────────────────

  const revenueThisMonth  = Number(paymentsThisMonth._sum.amount  ?? 0)
  const revenueLastMonth  = Number(paymentsLastMonth._sum.amount  ?? 0)

  // ── Conversion rate ───────────────────────────────────────────────────────

  const completedCount = allActiveBookingsThisMonth.filter((b) => b.status === 'COMPLETED').length
  const totalConversionBase = allActiveBookingsThisMonth.length
  const conversionRate = totalConversionBase > 0
    ? (completedCount / totalConversionBase) * 100
    : 0

  // ── Top services — enrich with service names and revenue ─────────────────

  const serviceIds = topServices.map((s) => s.serviceId)
  const serviceDetails = await db.service.findMany({
    where: { id: { in: serviceIds } },
    select: { id: true, name: true },
  })
  const serviceMap = Object.fromEntries(serviceDetails.map((s) => [s.id, s.name]))

  // Revenue per service this month
  const serviceRevenue = await db.payment.groupBy({
    by:    ['bookingId'],
    where: {
      status:  'PAID',
      paidAt:  { gte: monthStart },
      booking: { businessId, serviceId: { in: serviceIds } },
    },
    _sum: { amount: true },
  })

  // Join service revenue with booking → service mapping
  const bookingServiceMap = await db.booking.findMany({
    where: { id: { in: serviceRevenue.map((r) => r.bookingId) } },
    select: { id: true, serviceId: true },
  })
  const bookingToService = Object.fromEntries(bookingServiceMap.map((b) => [b.id, b.serviceId]))
  const revenueByService: Record<string, number> = {}
  for (const rev of serviceRevenue) {
    const sid = bookingToService[rev.bookingId]
    if (sid) revenueByService[sid] = (revenueByService[sid] ?? 0) + Number(rev._sum.amount ?? 0)
  }

  // ── Technician ratings ────────────────────────────────────────────────────

  const techBookingIds = technicians.flatMap((t) =>
    t.jobs.map((j) => j.booking.id)
  )
  const techRatings = await db.rating.findMany({
    where: { bookingId: { in: techBookingIds } },
    select: { bookingId: true, score: true },
  })
  const ratingByBooking = Object.fromEntries(techRatings.map((r) => [r.bookingId, r.score]))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {now.toLocaleString('en-ZA', { month: 'long', year: 'numeric' })} — month to date
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
          label="Avg Rating"
          value={
            ratingsThisMonth._avg.score !== null
              ? `${Number(ratingsThisMonth._avg.score).toFixed(1)} / 5`
              : '—'
          }
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
      </div>

      {/* ── Tables ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top Services */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Top Services This Month</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topServices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No data for this period
                    </TableCell>
                  </TableRow>
                )}
                {topServices.map((s) => (
                  <TableRow key={s.serviceId}>
                    <TableCell>{serviceMap[s.serviceId] ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s._count.serviceId}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      R {(revenueByService[s.serviceId] ?? 0).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        {/* Technician Performance */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Technician Performance This Month</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Technician</TableHead>
                  <TableHead className="text-right">Jobs Done</TableHead>
                  <TableHead className="text-right">Avg Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {technicians.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No technicians found
                    </TableCell>
                  </TableRow>
                )}
                {technicians
                  .sort((a, b) => b.jobs.length - a.jobs.length)
                  .map((tech) => {
                    const jobBookingIds = tech.jobs.map((j) => j.booking.id)
                    const scores = jobBookingIds
                      .map((bid) => ratingByBooking[bid])
                      .filter((s): s is number => s !== undefined)
                    const avgRating =
                      scores.length > 0
                        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
                        : null

                    return (
                      <TableRow key={tech.id}>
                        <TableCell>{tech.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{tech.jobs.length}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {avgRating ? `${avgRating} / 5` : '—'}
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
