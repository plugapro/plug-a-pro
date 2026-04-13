export const dynamic = 'force-dynamic'

import Link from 'next/link'
import type { JobStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Field Exceptions', noIndex: true })

const FIELD_EXCEPTION_STATUSES: JobStatus[] = [
  'AWAITING_APPROVAL',
  'PENDING_COMPLETION_CONFIRMATION',
  'FAILED',
  'CALLBACK_REQUIRED',
]

export default async function AdminFieldExceptionsPage() {
  const admin = await requireAdmin()
  const now = new Date()

  const jobs = await db.job.findMany({
    where: { status: { in: FIELD_EXCEPTION_STATUSES } },
    select: {
      id: true,
      status: true,
      failureReason: true,
      updatedAt: true,
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      booking: {
        select: {
          id: true,
          scheduledDate: true,
          scheduledWindow: true,
          match: {
            select: {
              jobRequest: {
                select: {
                  id: true,
                  title: true,
                  category: true,
                  customer: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
                    },
                  },
                  address: {
                    select: {
                      suburb: true,
                      city: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  })

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.FIELD_EXCEPTION,
    jobs.map((job) => job.id),
  )

  async function claimFieldException(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobId = String(formData.get('jobId') ?? '')
    if (!jobId) return

    await claimOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.FIELD_EXCEPTION,
      entityId: jobId,
      claimedById: activeAdmin.id,
      claimedByRole: activeAdmin.role,
      claimedByLabel: activeAdmin.email ?? 'admin',
    })

    revalidatePath('/admin/field-exceptions')
    revalidatePath('/admin')
  }

  async function releaseFieldException(formData: FormData) {
    'use server'
    await requireAdmin()
    const jobId = String(formData.get('jobId') ?? '')
    if (!jobId) return

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.FIELD_EXCEPTION,
      entityId: jobId,
    })

    revalidatePath('/admin/field-exceptions')
    revalidatePath('/admin')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Field Exceptions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jobs in-flight that are blocked, waiting on customer action, or need manual recovery.
          </p>
        </div>
        <Badge variant={jobs.length > 0 ? 'danger' : 'neutral'}>
          {jobs.length} escalated
        </Badge>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No field exceptions are open right now.
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const assignment = assignments.get(job.id)
            const claimedByCurrentUser = assignment?.claimedById === admin.id
            const request = job.booking.match.jobRequest

            return (
              <Card key={job.id}>
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{request.title}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {job.provider.name} · {request.customer.name}
                        {request.address ? ` · ${request.address.suburb}, ${request.address.city}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={job.status} type="job" />
                      <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                        {formatOpsQueueOwnerLabel(assignment, admin.id)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant={slaToneVariant(getSlaTone(job.updatedAt, now, 60))}>
                      Last update {formatAge(job.updatedAt, now)}
                    </Badge>
                    <Badge variant="outline">{formatBookingWindow(job.booking.scheduledDate, job.booking.scheduledWindow)}</Badge>
                    <Badge variant="outline">{request.category}</Badge>
                    {job.failureReason ? <Badge variant="outline">{job.failureReason}</Badge> : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!claimedByCurrentUser ? (
                      <form action={claimFieldException}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <Button type="submit" variant="outline" size="sm">
                          {assignment?.claimedById ? 'Take over' : 'Claim'}
                        </Button>
                      </form>
                    ) : (
                      <form action={releaseFieldException}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Release
                        </Button>
                      </form>
                    )}

                    <Button asChild size="sm">
                      <Link href={`/admin/bookings/${job.booking.id}`}>Open booking</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/customers/${request.customer.id}`}>Open customer</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/providers/${job.provider.id}`}>Open provider</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatAge(from: Date, to: Date) {
  const diffMs = Math.max(0, to.getTime() - from.getTime())
  const minutes = Math.floor(diffMs / 60000)

  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  return `${Math.floor(hours / 24)}d`
}

function getSlaTone(updatedAt: Date, now: Date, targetMinutes: number) {
  const ageMinutes = (now.getTime() - updatedAt.getTime()) / 60000
  if (ageMinutes > targetMinutes) return 'danger' as const
  if (ageMinutes > targetMinutes * 0.6) return 'warning' as const
  return 'default' as const
}

function slaToneVariant(tone: 'default' | 'warning' | 'danger') {
  if (tone === 'danger') return 'danger' as const
  if (tone === 'warning') return 'warning' as const
  return 'neutral' as const
}

function formatBookingWindow(scheduledDate: Date, scheduledWindow: string | null) {
  if (scheduledWindow) return scheduledWindow

  return scheduledDate.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}
