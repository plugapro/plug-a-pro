export const revalidate = 60

import { Badge } from '@/components/ui/badge'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { rolesForCapability } from '@/lib/ops-dashboard/permissions'
import { getPublicAppUrl } from '@/lib/provider-credit-copy'

export const metadata = buildMetadata({ title: 'Scheduler', noIndex: true })

const SCHEDULED_JOBS = [
  {
    name: 'Match leads and Ops alerts',
    path: '/api/cron/match-leads',
    cadence: '*/5 5-16 * * * and */30 17-23,0-4 * * *',
    role: 'Provider opportunity dispatch, shortlist support, expiry, reminders, provider review routing, Ops alerts',
  },
  { name: 'Candidate pool rebuild', path: '/api/internal/cron/rebuild-candidate-pool', cadence: '*/5 6-22 * * *', role: 'Refresh provider candidate pool' },
  { name: 'Session timeout', path: '/api/cron/session-timeout', cadence: '*/20 5-20 * * *', role: 'WhatsApp conversation recovery' },
  { name: 'Reminders', path: '/api/cron/reminders', cadence: '0 8 * * *', role: 'Booking reminders' },
  { name: 'Follow-up', path: '/api/cron/follow-up', cadence: '0 10 * * *', role: 'Customer follow-up' },
  { name: 'Slots cleanup', path: '/api/cron/slots', cadence: '0 6 * * 1', role: 'Legacy stale request cleanup' },
]

async function loadSchedulerCounts() {
  // Compute time bounds outside the Promise.all so the React Compiler does
  // not flag `new Date()` as a side effect during render.
  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  return Promise.all([
    db.jobRequest.count({ where: { status: { in: ['OPEN', 'MATCHING'] } } }),
    db.providerApplication.count({ where: { status: 'PENDING' } }),
    db.lead.count({ where: { status: { in: ['SENT', 'VIEWED'] }, expiresAt: { gt: now } } }),
    db.messageEvent.count({ where: { status: 'FAILED', createdAt: { gte: twentyFourHoursAgo } } }),
    db.auditLog.findMany({
      where: { action: 'ops_alert.sent', timestamp: { gte: twentyFourHoursAgo } },
      orderBy: { timestamp: 'desc' },
      take: 10,
    }),
  ])
}

export default async function AdminSchedulerPage() {
  await requireRole(rolesForCapability('runSchedulers'))

  const [
    openRequests,
    pendingApplications,
    pendingInvites,
    failedMessages,
    recentOpsAlerts,
  ] = await loadSchedulerCounts()

  const appUrl = getPublicAppUrl()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Scheduler and cron</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor scheduler responsibilities, current queue pressure, and recent Ops alerts. Manual execution remains restricted to Admin/Owner.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Open / matching requests" value={openRequests} />
        <Metric label="Pending provider reviews" value={pendingApplications} />
        <Metric label="Active provider invites" value={pendingInvites} />
        <Metric label="Failed messages, 24h" value={failedMessages} />
      </div>

      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Configured jobs</h2>
          <p className="text-xs text-muted-foreground">Production public URL: {appUrl || 'not configured'}</p>
        </div>
        <div className="divide-y">
          {SCHEDULED_JOBS.map((job) => (
            <div key={`${job.path}:${job.cadence}`} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[220px_260px_1fr]">
              <div>
                <p className="font-medium">{job.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{job.path}</p>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{job.cadence}</p>
              <p className="text-muted-foreground">{job.role}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Safety rules currently enforced</h2>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <SafetyRule label="No blind provider auto-approval" />
          <SafetyRule label="No credit deduction during matching" />
          <SafetyRule label="No job assignment before customer selection and selected-provider acceptance" />
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Recent Ops scheduler alerts</h2>
        </div>
        <div className="divide-y">
          {recentOpsAlerts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No Ops alerts in the last 24 hours.</p>
          ) : null}
          {recentOpsAlerts.map((alert) => (
            <div key={alert.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{alert.entityId}</p>
                <Badge variant="outline">{alert.timestamp.toLocaleString('en-ZA')}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{JSON.stringify(alert.after)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function SafetyRule({ label }: { label: string }) {
  return <div className="tone-success rounded-lg border px-3 py-2 text-sm">{label}</div>
}
