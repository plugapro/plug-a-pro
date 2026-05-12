export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { CrudActionError, crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { buildMetadata } from '@/lib/metadata'
import { getQueueAgeTone } from '@/lib/ops-dashboard/alerts'
import { orchestrateMatch } from '@/lib/matching/orchestrator'
import { openCase, resolveCase } from '@/lib/cases'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { getValidationAdminMessage } from '@/lib/admin-action-messages'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { StaleBanner } from '@/components/admin/dashboard/StaleBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/admin/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Validation Queue', noIndex: true })
const FLAG = 'admin.crud.validation'
const VALIDATION_ROLES = ['OPS', 'ADMIN', 'OWNER'] as const
const QueueSchema = z.object({
  jobRequestId: z.string().min(1),
})

export default async function AdminValidationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const admin = await requireAdmin()
  const now = new Date()
  const pageWarnings: string[] = []
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const { message } = await searchParams
  const banner = getValidationAdminMessage(message)

  const requests = await db.jobRequest.findMany({
    where: { status: 'PENDING_VALIDATION' },
    select: {
      id: true,
      title: true,
      category: true,
      description: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      address: {
        select: {
          street: true,
          suburb: true,
          city: true,
          province: true,
        },
      },
      _count: {
        select: {
          attachments: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  }).catch((error) => {
    console.error('[admin/validation] Failed to load validation queue', error)
    pageWarnings.push('Validation queue data is temporarily unavailable.')
    return []
  })

  const requestIds = requests.map((request) => request.id)

  const [assignments, rawAuditLogs] = await Promise.all([
    listOpsQueueAssignments(db, OPS_QUEUE_TYPES.VALIDATION, requestIds).catch((error) => {
      console.error('[admin/validation] Failed to load queue assignments', error)
      pageWarnings.push('Assignment ownership data is temporarily unavailable.')
      return new Map() as Awaited<ReturnType<typeof listOpsQueueAssignments>>
    }),
    db.auditLog.findMany({
      where: { entityId: { in: requestIds }, entityType: AUDIT_ENTITY.JOB_REQUEST },
      select: { id: true, entityId: true, action: true, actorRole: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: requestIds.length * 5 + 10,
    }).catch((error) => {
      console.error('[admin/validation] Failed to load audit logs', error)
      pageWarnings.push('Recent activity failed to load.')
      return [] as Array<{ id: string; entityId: string | null; action: string; actorRole: string; timestamp: Date }>
    }),
  ])

  const auditByRequest = new Map<string, typeof rawAuditLogs>()
  for (const log of rawAuditLogs) {
    if (!log.entityId) continue
    const list = auditByRequest.get(log.entityId) ?? []
    list.push(log)
    auditByRequest.set(log.entityId, list)
  }

  async function claimValidation(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    try {
      await crudAction({
        entity: 'JobRequest',
        action: 'job_request.validation_claim',
        requiredRole: [...VALIDATION_ROLES],
        requiredFlag: FLAG,
        schema: QueueSchema,
        input: { jobRequestId: String(formData.get('jobRequestId') ?? '') },
        run: async ({ jobRequestId }, tx) => {
          await claimOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.VALIDATION,
            entityId: jobRequestId,
            claimedById: activeAdmin.id,
            claimedByRole: activeAdmin.adminRole,
            claimedByLabel: activeAdmin.email ?? 'admin',
          })
          return { id: jobRequestId, claimedById: activeAdmin.id }
        },
      })
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      console.error('[admin/validation] claimValidation failed:', error)
      redirect('/admin/validation?message=validation_claim_failed')
    }

    redirect('/admin/validation')
  }

  async function releaseValidation(formData: FormData) {
    'use server'
    try {
      await crudAction({
        entity: 'JobRequest',
        action: 'job_request.validation_release',
        requiredRole: [...VALIDATION_ROLES],
        requiredFlag: FLAG,
        schema: QueueSchema,
        input: { jobRequestId: String(formData.get('jobRequestId') ?? '') },
        run: async ({ jobRequestId }, tx) => {
          await releaseOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.VALIDATION,
            entityId: jobRequestId,
          })
          return { id: jobRequestId, released: true }
        },
      })
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      console.error('[admin/validation] releaseValidation failed:', error)
      redirect('/admin/validation?message=validation_release_failed')
    }

    redirect('/admin/validation')
  }

  async function markReadyForMatching(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    try {
      const result = await crudAction({
        entity: 'JobRequest',
        entityId: jobRequestId,
        action: 'job_request.validation_complete',
        requiredRole: [...VALIDATION_ROLES],
        requiredFlag: FLAG,
        schema: QueueSchema,
        input: { jobRequestId },
        run: async ({ jobRequestId }, tx) => {
          const existing = await tx.jobRequest.findUnique({
            where: { id: jobRequestId },
            select: { status: true },
          })
          if (!existing || existing.status !== 'PENDING_VALIDATION') {
            throw new CrudActionError('CONFLICT', 'Request is not waiting for validation.')
          }

          await tx.jobRequest.update({
            where: { id: jobRequestId },
            data: { status: 'OPEN' },
          })

          await releaseOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.VALIDATION,
            entityId: jobRequestId,
          })

          return { id: jobRequestId, status: 'OPEN' }
        },
      })

      await orchestrateMatch(result.data.id, { triggeredBy: 'manual' }).catch((error) => {
        console.error('[admin/validation] Failed to dispatch after validation', {
          jobRequestId: result.data.id,
          error,
        })
      })
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      console.error('[admin/validation] markReadyForMatching failed:', error)
      redirect('/admin/validation?message=validation_ready_failed')
    }

    // Close VALIDATION case, open DISPATCH case
    const validationCase = await db.case.findUnique({
      where: { entityType_entityId_queueType: { entityType: 'JOB_REQUEST', entityId: jobRequestId, queueType: 'VALIDATION' } },
    })
    if (validationCase) {
      await resolveCase({ caseId: validationCase.id, resolvedBy: activeAdmin.id, reasonCode: 'VALIDATED', outcome: 'approved' }).catch(() => {})
    }
    openCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: jobRequestId })
      .catch((err) => console.error('[admin/validation] openCase DISPATCH failed:', err))

    redirect('/admin/validation')
  }

  async function cancelRequest(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    try {
      await crudAction({
        entity: 'JobRequest',
        entityId: jobRequestId,
        action: 'job_request.validation_cancelled',
        requiredRole: [...VALIDATION_ROLES],
        requiredFlag: FLAG,
        schema: QueueSchema,
        input: { jobRequestId },
        run: async ({ jobRequestId }, tx) => {
          const existing = await tx.jobRequest.findUnique({
            where: { id: jobRequestId },
            select: { status: true },
          })
          if (!existing || existing.status !== 'PENDING_VALIDATION') {
            throw new CrudActionError('CONFLICT', 'Request is not waiting for validation.')
          }

          await tx.jobRequest.update({
            where: { id: jobRequestId },
            data: { status: 'CANCELLED' },
          })

          await releaseOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.VALIDATION,
            entityId: jobRequestId,
          })

          return { id: jobRequestId, status: 'CANCELLED' }
        },
      })
    } catch (error) {
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      console.error('[admin/validation] cancelRequest failed:', error)
      redirect('/admin/validation?message=validation_cancel_failed')
    }

    // Close VALIDATION case on cancel
    const validationCaseToClose = await db.case.findUnique({
      where: { entityType_entityId_queueType: { entityType: 'JOB_REQUEST', entityId: jobRequestId, queueType: 'VALIDATION' } },
    })
    if (validationCaseToClose) {
      await resolveCase({ caseId: validationCaseToClose.id, resolvedBy: activeAdmin.id, reasonCode: 'CANCELLED', outcome: 'cancelled' }).catch(() => {})
    }

    redirect('/admin/validation')
  }

  return (
    <div className="space-y-6">
      {pageWarnings.length > 0 ? <StaleBanner refreshHref="/admin/validation" /> : null}
      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${banner.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'tone-success'}`}>
          {banner.text}
        </div>
      ) : null}
      {!crudEnabled ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Validation queue mutations are read-only while <code>{FLAG}</code> is disabled.
        </div>
      ) : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Validation Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Legacy or manually created requests that still need an ops review before matching starts.
          </p>
        </div>
        <Badge variant={requests.length > 0 ? 'warning' : 'neutral'}>
          {requests.length} waiting
        </Badge>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No requests are waiting on validation.
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => {
            const assignment = assignments.get(request.id)
            const claimedByCurrentUser = assignment?.claimedById === admin.id

            return (
              <Card key={request.id}>
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{request.title}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {request.category} · {request.customer.name} · {request.address
                          ? `${request.address.suburb}, ${request.address.city}`
                          : 'Area unavailable'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status="PENDING_VALIDATION" type="jobRequest" />
                      <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                        {formatOpsQueueOwnerLabel(assignment, admin.id)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{request.description || 'No additional detail provided.'}</p>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant={slaToneVariant(getQueueAgeTone('validation', ageMinutes(request.createdAt, now)))}>
                      Age {formatAge(request.createdAt)}
                    </Badge>
                    <Badge variant="outline">Phone {request.customer.phone}</Badge>
                    <Badge variant="outline">{request._count.attachments} attachments</Badge>
                    {request.address ? (
                      <Badge variant="outline">
                        {request.address.street}, {request.address.province}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!claimedByCurrentUser ? (
                      <form action={claimValidation}>
                        <input type="hidden" name="jobRequestId" value={request.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!crudEnabled}>
                          {assignment?.claimedById ? 'Take over' : 'Claim'}
                        </SubmitButton>
                      </form>
                    ) : (
                      <form action={releaseValidation}>
                        <input type="hidden" name="jobRequestId" value={request.id} />
                        <SubmitButton variant="outline" size="sm" disabled={!crudEnabled}>
                          Release
                        </SubmitButton>
                      </form>
                    )}

                    <form action={markReadyForMatching}>
                      <input type="hidden" name="jobRequestId" value={request.id} />
                      <SubmitButton size="sm" disabled={!crudEnabled}>
                        Mark ready for matching
                      </SubmitButton>
                    </form>

                    <form action={cancelRequest}>
                      <input type="hidden" name="jobRequestId" value={request.id} />
                      <SubmitButton variant="outline" size="sm" disabled={!crudEnabled}>
                        Cancel request
                      </SubmitButton>
                    </form>

                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/customers/${request.customer.id}`}>Open customer</Link>
                    </Button>
                  </div>

                  {(() => {
                    const trail = auditByRequest.get(request.id) ?? []
                    if (trail.length === 0) return null
                    return (
                      <div className="border-t pt-3 space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activity</p>
                        {trail.slice(0, 4).map((entry) => (
                          <div key={entry.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0 tabular-nums">{formatAge(entry.timestamp)}</span>
                            <span className="font-medium text-foreground/70">{entry.action.replace(/\./g, ' · ')}</span>
                            <span className="ml-auto shrink-0">{entry.actorRole}</span>
                          </div>
                        ))}
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

function formatAge(date: Date) {
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.floor(diffMs / 60000))

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
