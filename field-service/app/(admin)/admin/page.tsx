// Admin dashboard — KPI overview
// Server-rendered, daily metrics at a glance

export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { KpiCard } from '@/components/admin/KpiCard'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Dashboard', noIndex: true })

export default async function AdminDashboardPage() {
  await requireAdmin()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  const [
    todayBookings,
    todayJobs,
    pendingQuotes,
    activeJobs,
    weekRevenue,
    pendingPayments,
    pendingApplications,
    openJobRequests,
    totalProviders,
  ] = await Promise.all([
    db.booking.count({
      where: {
        createdAt: { gte: today, lt: tomorrow },
        status: { not: 'CANCELLED' },
      },
    }),
    db.job.count({
      where: {
        status: { notIn: ['COMPLETED', 'FAILED'] },
        booking: { scheduledDate: { gte: today, lt: tomorrow } },
      },
    }),
    db.quote.count({
      where: { status: 'PENDING' },
    }),
    db.job.count({
      where: {
        status: { in: ['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL'] },
      },
    }),
    db.payment.aggregate({
      where: {
        status: 'PAID',
        paidAt: { gte: weekAgo },
      },
      _sum: { amount: true },
    }),
    db.booking.count({
      where: { status: 'SCHEDULED' },
    }),
    db.providerApplication.count({
      where: { status: 'PENDING' },
    }),
    db.jobRequest.count({
      where: { status: { notIn: ['CANCELLED', 'EXPIRED'] } },
    }),
    db.provider.count({
      where: { active: true },
    }),
  ])

  const kpis = [
    {
      label: "Today's Bookings",
      value: todayBookings,
      description: 'New bookings created today',
      href: '/admin/bookings',
    },
    {
      label: "Today's Jobs",
      value: todayJobs,
      description: 'Jobs scheduled for today',
      href: '/admin/matches',
    },
    {
      label: 'Active in Field',
      value: activeJobs,
      description: 'Providers currently on a job',
      href: '/admin/matches',
      highlight: activeJobs > 0,
    },
    {
      label: 'Pending Quotes',
      value: pendingQuotes,
      description: 'Quotes awaiting review',
      href: '/admin/bookings?tab=quotes',
      highlight: pendingQuotes > 0,
    },
    {
      label: 'Scheduled Bookings',
      value: pendingPayments,
      description: 'Bookings in scheduled state',
      href: '/admin/bookings',
    },
    {
      label: '7-Day Revenue',
      value: `R ${Number(weekRevenue._sum.amount ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`,
      description: 'Collected in last 7 days',
      href: '/admin/reports',
    },
    {
      label: 'Applications',
      value: pendingApplications,
      description: 'Provider applications pending review',
      href: '/admin/applications',
      highlight: pendingApplications > 0,
    },
    {
      label: 'Open Job Requests',
      value: openJobRequests,
      description: 'Active job requests from customers',
      href: '/admin/matches',
      highlight: openJobRequests > 0,
    },
    {
      label: 'Active Providers',
      value: totalProviders,
      description: 'Providers currently active on platform',
      href: '/admin/providers',
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {today.toLocaleDateString('en-ZA', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>
    </div>
  )
}
