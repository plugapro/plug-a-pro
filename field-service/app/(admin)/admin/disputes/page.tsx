export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/audit'
import { buildMetadata } from '@/lib/metadata'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export const metadata = buildMetadata({ title: 'Disputes', noIndex: true })

const DISPUTE_STYLES: Record<string, 'danger' | 'warning' | 'info' | 'success' | 'brand' | 'neutral'> = {
  OPEN: 'danger',
  UNDER_REVIEW: 'warning',
  RESOLVED_CUSTOMER: 'info',
  RESOLVED_PROVIDER: 'success',
  RESOLVED_SPLIT: 'brand',
  CLOSED: 'neutral',
}

async function updateDisputeAction(formData: FormData) {
  'use server'

  const admin = await requireAdmin()
  const disputeId = String(formData.get('disputeId') ?? '')
  const status = String(formData.get('status') ?? '')
  const resolution = String(formData.get('resolution') ?? '').trim() || null

  if (!disputeId) return
  if (!['OPEN', 'UNDER_REVIEW', 'RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'RESOLVED_SPLIT', 'CLOSED'].includes(status)) {
    return
  }

  const resolvedStatuses = ['RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'RESOLVED_SPLIT', 'CLOSED']
  const existing = await db.dispute.findUnique({
    where: { id: disputeId },
    select: {
      status: true,
      resolution: true,
      resolvedAt: true,
      resolvedById: true,
    },
  })
  if (!existing) return

  await db.dispute.update({
    where: { id: disputeId },
    data: {
      status: status as 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED_CUSTOMER' | 'RESOLVED_PROVIDER' | 'RESOLVED_SPLIT' | 'CLOSED',
      resolution,
      resolvedAt: resolvedStatuses.includes(status) ? new Date() : null,
      resolvedById: resolvedStatuses.includes(status) ? admin.id : null,
    },
  })

  await recordAuditLog({
    actorId: admin.id,
    actorRole: admin.role,
    action: 'dispute.update',
    entityType: 'dispute',
    entityId: disputeId,
    before: existing,
    after: {
      status,
      resolution,
      resolvedAt: resolvedStatuses.includes(status) ? new Date().toISOString() : null,
      resolvedById: resolvedStatuses.includes(status) ? admin.id : null,
    },
  })

  revalidatePath('/admin/disputes')
  revalidatePath('/admin')
}

async function claimDisputeAction(formData: FormData) {
  'use server'

  const admin = await requireAdmin()
  const disputeId = String(formData.get('disputeId') ?? '')
  if (!disputeId) return

  await claimOpsQueueItem(db, {
    queueType: OPS_QUEUE_TYPES.DISPUTE,
    entityId: disputeId,
    claimedById: admin.id,
    claimedByRole: admin.role,
    claimedByLabel: admin.email ?? 'admin',
  })

  revalidatePath('/admin/disputes')
  revalidatePath('/admin')
}

async function releaseDisputeAction(formData: FormData) {
  'use server'

  await requireAdmin()
  const disputeId = String(formData.get('disputeId') ?? '')
  if (!disputeId) return

  await releaseOpsQueueItem(db, {
    queueType: OPS_QUEUE_TYPES.DISPUTE,
    entityId: disputeId,
  })

  revalidatePath('/admin/disputes')
  revalidatePath('/admin')
}

export default async function AdminDisputesPage() {
  const admin = await requireAdmin()

  const disputes = await db.dispute.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const jobs = await db.job.findMany({
    where: { id: { in: disputes.map((dispute) => dispute.jobId) } },
    include: {
      provider: { select: { id: true, name: true } },
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  customer: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.DISPUTE,
    disputes.map((dispute) => dispute.id),
  )

  const jobById = new Map(jobs.map((job) => [job.id, job]))
  const openCount = disputes.filter((dispute) => dispute.status === 'OPEN').length
  const underReviewCount = disputes.filter((dispute) => dispute.status === 'UNDER_REVIEW').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Disputes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manual review queue for jobs that need intervention.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard label="Open disputes" value={openCount} />
        <SummaryCard label="Under review" value={underReviewCount} />
      </div>

      {disputes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No disputes have been raised yet.
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map((dispute) => {
            const job = jobById.get(dispute.jobId)
            const booking = job?.booking
            const customer = booking?.match.jobRequest.customer
            const assignment = assignments.get(dispute.id)
            const claimedByCurrentUser = assignment?.claimedById === admin.id
            return (
              <div key={dispute.id} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">Dispute #{dispute.id.slice(-8).toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">
                      Raised by {dispute.raisedByRole} on{' '}
                      {dispute.createdAt.toLocaleDateString('en-ZA', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={DISPUTE_STYLES[dispute.status] ?? DISPUTE_STYLES.OPEN}>
                      {dispute.status.replaceAll('_', ' ').toLowerCase()}
                    </Badge>
                    <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                      {formatOpsQueueOwnerLabel(assignment, admin.id)}
                    </Badge>
                  </div>
                </div>

                <p className="text-sm">{dispute.reason}</p>

                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer</p>
                    {customer ? (
                      <Link href={`/admin/customers/${customer.id}`} className="font-medium hover:text-primary">
                        {customer.name}
                      </Link>
                    ) : (
                      <p className="text-muted-foreground">Unknown</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Provider</p>
                    {job?.provider ? (
                      <Link href={`/admin/providers/${job.provider.id}`} className="font-medium hover:text-primary">
                        {job.provider.name}
                      </Link>
                    ) : (
                      <p className="text-muted-foreground">Unknown</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Booking</p>
                    {booking ? (
                      <Link href={`/admin/bookings/${booking.id}`} className="font-medium hover:text-primary">
                        {booking.id.slice(-8).toUpperCase()}
                      </Link>
                    ) : (
                      <p className="text-muted-foreground">No booking linked</p>
                    )}
                  </div>
                </div>

                {dispute.resolution && (
                  <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Resolution</p>
                    <p className="mt-1">{dispute.resolution}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {!claimedByCurrentUser ? (
                    <form action={claimDisputeAction}>
                      <input type="hidden" name="disputeId" value={dispute.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {assignment?.claimedById ? 'Take over' : 'Claim'}
                      </Button>
                    </form>
                  ) : (
                    <form action={releaseDisputeAction}>
                      <input type="hidden" name="disputeId" value={dispute.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Release
                      </Button>
                    </form>
                  )}
                </div>

                <form action={updateDisputeAction} className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
                  <input type="hidden" name="disputeId" value={dispute.id} />
                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <Select
                      name="status"
                      defaultValue={dispute.status}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OPEN">Open</SelectItem>
                        <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
                        <SelectItem value="RESOLVED_CUSTOMER">Resolved for customer</SelectItem>
                        <SelectItem value="RESOLVED_PROVIDER">Resolved for provider</SelectItem>
                        <SelectItem value="RESOLVED_SPLIT">Resolved with split outcome</SelectItem>
                        <SelectItem value="CLOSED">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Textarea
                      name="resolution"
                      defaultValue={dispute.resolution ?? ''}
                      placeholder="Add internal resolution notes for this case."
                      className="min-h-24"
                    />
                  </div>
                  <Button
                    type="submit"
                  >
                    Save dispute update
                  </Button>
                </form>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
