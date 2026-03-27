// ─── Technician: Job list ─────────────────────────────────────────────────────
// Today's active jobs + upcoming assigned jobs.

export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { requireTechnician } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { JobCard } from '@/components/technician/JobCard'

export const metadata = buildMetadata({ title: 'My Jobs', noIndex: true })

export default async function TechnicianHomePage() {
  const session = await requireTechnician()

  const technician = await db.technician.findUnique({
    where: { userId: session.id },
  })

  if (!technician) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground">
        <p>Your technician account is not yet set up.</p>
        <p className="text-sm mt-1">Please contact your administrator.</p>
      </div>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const [activeJobs, upcomingJobs] = await Promise.all([
    db.job.findMany({
      where: {
        technicianId: technician.id,
        status: { in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED', 'AWAITING_APPROVAL'] },
      },
      include: {
        booking: {
          include: { service: true, address: true, customer: true },
        },
      },
      orderBy: { booking: { scheduledDate: 'asc' } },
    }),
    db.job.findMany({
      where: {
        technicianId: technician.id,
        status: 'ASSIGNED',
        booking: { scheduledDate: { gte: tomorrow, lt: nextWeek } },
      },
      include: {
        booking: { include: { service: true, address: true, customer: true } },
      },
      orderBy: { booking: { scheduledDate: 'asc' } },
      take: 10,
    }),
  ])

  return (
    <div className="px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My Jobs</h1>
        <p className="text-sm text-muted-foreground">{technician.name}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Active ({activeJobs.length})
        </h2>
        {activeJobs.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">No active jobs right now.</p>
        )}
        {activeJobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </section>

      {upcomingJobs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Upcoming ({upcomingJobs.length})
          </h2>
          {upcomingJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </section>
      )}

      {activeJobs.length === 0 && upcomingJobs.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center space-y-2">
          <p className="text-muted-foreground">No jobs assigned yet.</p>
          <p className="text-sm text-muted-foreground">
            You'll receive a WhatsApp message when a job is ready.
          </p>
        </div>
      )}
    </div>
  )
}
