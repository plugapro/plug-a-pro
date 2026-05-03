export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { rolesForCapability } from '@/lib/ops-dashboard/permissions'

export const metadata = buildMetadata({ title: 'Jobs', noIndex: true })

function ageHours(value: Date | null | undefined) {
  if (!value) return 0
  return Math.floor((Date.now() - value.getTime()) / 36e5)
}

function stuckReason(job: { status: string; assignedAt: Date | null; scheduledArrivalAt: Date | null; arrivalTimeConfirmedAt: Date | null }) {
  const assignedAge = ageHours(job.assignedAt)
  if (job.status === 'SCHEDULED' && !job.arrivalTimeConfirmedAt && assignedAge >= 2) return 'Arrival not confirmed'
  if (job.status === 'EN_ROUTE' && job.scheduledArrivalAt && job.scheduledArrivalAt < new Date(Date.now() - 60 * 60 * 1000)) return 'On the way overdue'
  if (job.status === 'ARRIVED' && assignedAge >= 8) return 'Arrived but not started'
  if (job.status === 'STARTED' && assignedAge >= 24) return 'In progress over 24h'
  if (job.status === 'PENDING_COMPLETION_CONFIRMATION' && assignedAge >= 48) return 'Completion awaiting sign-off'
  return null
}

export default async function AdminJobsPage() {
  await requireRole(rolesForCapability('viewRequests'))

  const jobs = await db.job.findMany({
    where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] } },
    select: {
      id: true,
      jobRef: true,
      status: true,
      assignedAt: true,
      scheduledArrivalAt: true,
      arrivalTimeConfirmedAt: true,
      arrivedAt: true,
      startedAt: true,
      completedAt: true,
      provider: { select: { id: true, name: true, phone: true, availableNow: true } },
      booking: {
        select: {
          id: true,
          status: true,
          scheduledDate: true,
          match: {
            select: {
              jobRequest: {
                select: {
                  id: true,
                  category: true,
                  customer: { select: { id: true, name: true, phone: true } },
                  selectedLeadInvite: { select: { id: true, unlock: { select: { id: true, creditsCharged: true } } } },
                },
              },
            },
          },
        },
      },
      statusHistory: { orderBy: { timestamp: 'asc' }, take: 8 },
      photos: { select: { id: true }, take: 4 },
    },
    orderBy: { assignedAt: 'desc' },
    take: 100,
  })

  const stuck = jobs.filter((job) => stuckReason(job))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Job operations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monitor active jobs, provider WhatsApp status updates, timelines, evidence, and stuck-job risks.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/field-exceptions">Field exceptions</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Active jobs" value={jobs.length} />
        <Metric label="Stuck / needs review" value={stuck.length} />
        <Metric label="Awaiting completion sign-off" value={jobs.filter((job) => job.status === 'PENDING_COMPLETION_CONFIRMATION').length} />
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Job</th>
              <th className="px-4 py-3 text-left font-medium">Customer / Request</th>
              <th className="px-4 py-3 text-left font-medium">Provider</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Next action</th>
              <th className="px-4 py-3 text-left font-medium">Evidence / Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {jobs.map((job) => {
              const request = job.booking.match.jobRequest
              const risk = stuckReason(job)
              return (
                <tr key={job.id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{job.jobRef}</p>
                    <Link href={`/admin/bookings/${job.booking.id}`} className="text-xs text-primary underline">Booking {job.booking.id.slice(-8).toUpperCase()}</Link>
                    <p className="text-xs text-muted-foreground">Assigned {job.assignedAt?.toLocaleString('en-ZA') ?? 'not set'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${request.customer.id}`} className="font-medium hover:text-primary">{request.customer.name}</Link>
                    <p className="text-xs text-muted-foreground">{request.category} · {request.id.slice(-8).toUpperCase()}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/providers/${job.provider.id}`} className="font-medium hover:text-primary">{job.provider.name}</Link>
                    <p className="text-xs text-muted-foreground">{job.provider.availableNow ? 'Available' : 'Not available'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} type="job" />
                    {risk ? <p className="mt-1"><Badge variant="destructive">{risk}</Badge></p> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {job.status === 'SCHEDULED' ? 'Provider confirms arrival or marks on the way via WhatsApp.' : null}
                    {job.status === 'EN_ROUTE' ? 'Provider should mark arrived.' : null}
                    {job.status === 'ARRIVED' ? 'Provider should start job.' : null}
                    {job.status === 'STARTED' ? 'Provider should complete job with note/photo.' : null}
                    {job.status === 'PENDING_COMPLETION_CONFIRMATION' ? 'Customer sign-off or Ops follow-up.' : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <p>{job.photos.length} photo(s)</p>
                    <p>Credit tx: {request.selectedLeadInvite?.unlock?.id ?? 'not linked'}</p>
                    <p>{job.statusHistory.length} timeline event(s)</p>
                  </td>
                </tr>
              )
            })}
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No active jobs.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
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
