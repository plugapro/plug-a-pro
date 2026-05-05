export const dynamic = 'force-dynamic'

import Link from 'next/link'
import type { JobStatus } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { CrudActionError, crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { getQueueAgeTone } from '@/lib/ops-dashboard/alerts'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { StaleBanner } from '@/components/admin/dashboard/StaleBanner'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CaseActivityTimeline } from '../_components/case-activity-timeline'
import { CaseNotes } from '../_components/case-notes'
import { ResolveCaseDialog } from '../_components/resolve-case-dialog'

export const metadata = buildMetadata({ title: 'Field Exceptions', noIndex: true })
const FLAG = 'admin.crud.field_exceptions'
const CASES_FLAG = 'ops.v2.cases'
const FIELD_EXCEPTION_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const
const QueueSchema = z.object({
  jobId: z.string().min(1),
})

const FIELD_EXCEPTION_STATUSES: JobStatus[] = [
  'AWAITING_APPROVAL',
  'PENDING_COMPLETION_CONFIRMATION',
  'FAILED',
  'CALLBACK_REQUIRED',
]

export default async function AdminFieldExceptionsPage() {
  const admin = await requireAdmin()
  const now = new Date()
  const pageWarnings: string[] = []
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const casesEnabled = await isEnabled(CASES_FLAG, { userId: admin.id })

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

  const jobIds = jobs.map((job) => job.id)

  const [assignments, rawAuditLogs] = await Promise.all([
    listOpsQueueAssignments(db, OPS_QUEUE_TYPES.FIELD_EXCEPTION, jobIds).catch((error) => {
      console.error('[admin/field-exceptions] Failed to load queue assignments', error)
      pageWarnings.push('Assignment ownership data is temporarily unavailable.')
      return new Map() as Awaited<ReturnType<typeof listOpsQueueAssignments>>
    }),
    db.auditLog.findMany({
      where: { entityId: { in: jobIds }, entityType: 'job' },
      select: { id: true, entityId: true, action: true, actorRole: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: jobIds.length * 5 + 10,
    }).catch((error) => {
      console.error('[admin/field-exceptions] Failed to load audit logs', error)
      pageWarnings.push('Recent field activity failed to load.')
      return [] as Array<{ id: string; entityId: string | null; action: string; actorRole: string; timestamp: Date }>
    }),
  ])

  // Fetch open cases for each booking (gated by flag)
  const bookingIds = jobs.map((job) => job.booking.id)
  const rawCases = casesEnabled
    ? await db.case.findMany({
        where: {
          entityType: 'BOOKING',
          entityId: { in: bookingIds },
          state: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
          notes: { orderBy: { createdAt: 'desc' } },
        },
      }).catch(() => [])
    : []
  const caseByBooking = new Map(rawCases.map((c) => [c.entityId, c]))

  const auditByJob = new Map<string, typeof rawAuditLogs>()
  for (const log of rawAuditLogs) {
    if (!log.entityId) continue
    const list = auditByJob.get(log.entityId) ?? []
    list.push(log)
    auditByJob.set(log.entityId, list)
  }

  async function claimFieldException(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    try {
      await crudAction({
        entity: 'Job',
        action: 'job.field_exception_claim',
        requiredRole: [...FIELD_EXCEPTION_ROLES],
        requiredFlag: FLAG,
        schema: QueueSchema,
        input: { jobId: String(formData.get('jobId') ?? '') },
        run: async ({ jobId }, tx) => {
          await claimOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.FIELD_EXCEPTION,
            entityId: jobId,
            claimedById: activeAdmin.id,
            claimedByRole: activeAdmin.adminRole,
            claimedByLabel: activeAdmin.email ?? 'admin',
          })
          return { id: jobId, claimedById: activeAdmin.id }
        },
      })
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
    }

    revalidatePath('/admin/field-exceptions')
    revalidatePath('/admin')
  }

  async function releaseFieldException(formData: FormData) {
    'use server'
    try {
      await crudAction({
        entity: 'Job',
        action: 'job.field_exception_release',
        requiredRole: [...FIELD_EXCEPTION_ROLES],
        requiredFlag: FLAG,
        schema: QueueSchema,
        input: { jobId: String(formData.get('jobId') ?? '') },
        run: async ({ jobId }, tx) => {
          await releaseOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.FIELD_EXCEPTION,
            entityId: jobId,
          })
          return { id: jobId, released: true }
        },
      })
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
    }

    revalidatePath('/admin/field-exceptions')
    revalidatePath('/admin')
  }

  return (
    <div className="space-y-6">
      {pageWarnings.length > 0 ? <StaleBanner refreshHref="/admin/field-exceptions" /> : null}
      {!crudEnabled ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Field exception mutations are read-only while <code>{FLAG}</code> is disabled.
        </div>
      ) : null}
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
                    <Badge variant={slaToneVariant(getQueueAgeTone('fieldExceptions', ageMinutes(job.updatedAt, now)))}>
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
                        <Button type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
                          {assignment?.claimedById ? 'Take over' : 'Claim'}
                        </Button>
                      </form>
                    ) : (
                      <form action={releaseFieldException}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <Button type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
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

                  {(() => {
                    const trail = auditByJob.get(job.id) ?? []
                    if (trail.length === 0) return null
                    return (
                      <div className="border-t pt-3 space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</p>
                        {trail.slice(0, 4).map((entry) => (
                          <div key={entry.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0 tabular-nums">{formatAge(entry.timestamp, now)}</span>
                            <span className="font-medium text-foreground/70">{entry.action.replace(/\./g, ' · ')}</span>
                            <span className="ml-auto shrink-0">{entry.actorRole}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  {casesEnabled && (() => {
                    const activeCase = caseByBooking.get(job.booking.id)
                    if (!activeCase) return null
                    return (
                      <div className="space-y-4 border-t pt-4 mt-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Case actions</p>
                          <ResolveCaseDialog caseId={activeCase.id} />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Timeline</p>
                          <CaseActivityTimeline events={activeCase.events} />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Notes</p>
                          <CaseNotes caseId={activeCase.id} notes={activeCase.notes} />
                        </div>
                      </div>
                    )
                  })()}
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

function ageMinutes(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000))
}

function slaToneVariant(tone: 'default' | 'warning' | 'danger') {
  if (tone === 'danger') return 'danger' as const
  if (tone === 'warning') return 'warning' as const
  return 'outline' as const
}

function formatBookingWindow(scheduledDate: Date, scheduledWindow: string | null) {
  if (scheduledWindow) return scheduledWindow

  return scheduledDate.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}
