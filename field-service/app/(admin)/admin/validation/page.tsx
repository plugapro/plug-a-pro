export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/audit'
import { buildMetadata } from '@/lib/metadata'
import { getQueueAgeTone } from '@/lib/ops-dashboard/alerts'
import { dispatchLeads } from '@/lib/matching-engine'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { StaleBanner } from '@/components/admin/dashboard/StaleBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = buildMetadata({ title: 'Validation Queue', noIndex: true })

export default async function AdminValidationQueuePage() {
  const admin = await requireAdmin()
  const now = new Date()
  const pageWarnings: string[] = []

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
      where: { entityId: { in: requestIds }, entityType: 'job_request' },
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
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    await claimOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.VALIDATION,
      entityId: jobRequestId,
      claimedById: activeAdmin.id,
      claimedByRole: activeAdmin.role,
      claimedByLabel: activeAdmin.email ?? 'admin',
      actor: { actorId: activeAdmin.id, actorRole: activeAdmin.role },
    })

    redirect('/admin/validation')
  }

  async function releaseValidation(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.VALIDATION,
      entityId: jobRequestId,
      actor: { actorId: activeAdmin.id, actorRole: activeAdmin.role },
    })

    redirect('/admin/validation')
  }

  async function markReadyForMatching(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    const existing = await db.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: { status: true },
    })
    if (!existing || existing.status !== 'PENDING_VALIDATION') {
      redirect('/admin/validation')
    }

    await db.jobRequest.update({
      where: { id: jobRequestId },
      data: { status: 'OPEN' },
    })

    await recordAuditLog({
      actorId: activeAdmin.id,
      actorRole: activeAdmin.role,
      action: 'job_request.validation_complete',
      entityType: 'job_request',
      entityId: jobRequestId,
      before: { status: existing.status },
      after: { status: 'OPEN' },
    })

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.VALIDATION,
      entityId: jobRequestId,
      actor: { actorId: activeAdmin.id, actorRole: activeAdmin.role },
    })

    await dispatchLeads(jobRequestId).catch((error) => {
      console.error('[admin/validation] Failed to dispatch leads after validation', {
        jobRequestId,
        error,
      })
    })

    redirect('/admin/validation')
  }

  async function cancelRequest(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    const existing = await db.jobRequest.findUnique({
      where: { id: jobRequestId },
      select: { status: true },
    })
    if (!existing || existing.status !== 'PENDING_VALIDATION') {
      redirect('/admin/validation')
    }

    await db.jobRequest.update({
      where: { id: jobRequestId },
      data: { status: 'CANCELLED' },
    })

    await recordAuditLog({
      actorId: activeAdmin.id,
      actorRole: activeAdmin.role,
      action: 'job_request.validation_cancelled',
      entityType: 'job_request',
      entityId: jobRequestId,
      before: { status: existing.status },
      after: { status: 'CANCELLED' },
    })

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.VALIDATION,
      entityId: jobRequestId,
      actor: { actorId: activeAdmin.id, actorRole: activeAdmin.role },
    })

    redirect('/admin/validation')
  }

  return (
    <div className="space-y-6">
      {pageWarnings.length > 0 ? <StaleBanner refreshHref="/admin/validation" /> : null}
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
                        <Button type="submit" variant="outline" size="sm">
                          {assignment?.claimedById ? 'Take over' : 'Claim'}
                        </Button>
                      </form>
                    ) : (
                      <form action={releaseValidation}>
                        <input type="hidden" name="jobRequestId" value={request.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Release
                        </Button>
                      </form>
                    )}

                    <form action={markReadyForMatching}>
                      <input type="hidden" name="jobRequestId" value={request.id} />
                      <Button type="submit" size="sm">
                        Mark ready for matching
                      </Button>
                    </form>

                    <form action={cancelRequest}>
                      <input type="hidden" name="jobRequestId" value={request.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Cancel request
                      </Button>
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
