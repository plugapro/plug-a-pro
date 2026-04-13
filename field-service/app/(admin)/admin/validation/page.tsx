export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/audit'
import { buildMetadata } from '@/lib/metadata'
import { dispatchLeads } from '@/lib/matching-engine'
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

export const metadata = buildMetadata({ title: 'Validation Queue', noIndex: true })

export default async function AdminValidationQueuePage() {
  const admin = await requireAdmin()

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
  })

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.VALIDATION,
    requests.map((request) => request.id),
  )

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
    })

    redirect('/admin/validation')
  }

  async function releaseValidation(formData: FormData) {
    'use server'
    await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.VALIDATION,
      entityId: jobRequestId,
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
    })

    redirect('/admin/validation')
  }

  return (
    <div className="space-y-6">
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
                    <Badge variant="outline">Age {formatAge(request.createdAt)}</Badge>
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
