// Admin dashboard — KPI overview
// Server-rendered, daily metrics at a glance

export const dynamic = 'force-dynamic'

import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { KpiCard } from '@/components/admin/KpiCard'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Dashboard', noIndex: true })

export default async function AdminDashboardPage() {
  const user = await requireAdmin()
  // Resolve businessId — use session value or fall back to env slug (single-tenant)
  let businessId = user.businessId
  if (!businessId) {
    const { resolveBusinessId } = await import('@/lib/auth')
    businessId = await resolveBusinessId()
  }

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
    awaitingDispatch,
  ] = await Promise.all([
    db.booking.count({
      where: {
        businessId,
        createdAt: { gte: today, lt: tomorrow },
        status: { not: 'CANCELLED' },
      },
    }),
    db.job.count({
      where: {
        technician: { businessId },
        status: { notIn: ['COMPLETED', 'FAILED'] },
        booking: { scheduledDate: { gte: today, lt: tomorrow } },
      },
    }),
    db.quote.count({
      where: { businessId, status: { in: ['NEW', 'UNDER_REVIEW'] } },
    }),
    db.job.count({
      where: {
        technician: { businessId },
        status: { in: ['EN_ROUTE', 'ARRIVED', 'STARTED', 'AWAITING_APPROVAL'] },
      },
    }),
    db.payment.aggregate({
      where: {
        booking: { businessId },
        status: 'PAID',
        paidAt: { gte: weekAgo },
      },
      _sum: { amount: true },
    }),
    db.booking.count({
      where: { businessId, status: 'PENDING_PAYMENT' },
    }),
    db.technicianApplication.count({
      where: { businessId, status: 'PENDING' },
    }),
    db.booking.count({
      where: { businessId, status: 'CONFIRMED', job: null },
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
      href: '/admin/dispatch',
    },
    {
      label: 'Active in Field',
      value: activeJobs,
      description: 'Technicians currently on a job',
      href: '/admin/dispatch',
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
      label: 'Pending Payment',
      value: pendingPayments,
      description: 'Bookings awaiting payment',
      href: '/admin/payments',
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
      description: 'Technician applications pending review',
      href: '/admin/applications',
      highlight: pendingApplications > 0,
    },
    {
      label: 'Awaiting Dispatch',
      value: awaitingDispatch,
      description: 'Confirmed bookings without a technician',
      href: '/admin/dispatch',
      highlight: awaitingDispatch > 0,
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
