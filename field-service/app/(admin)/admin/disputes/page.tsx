export const dynamic = 'force-dynamic'

import { z } from 'zod'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CaseActivityTimeline } from '../_components/case-activity-timeline'
import { CaseNotes } from '../_components/case-notes'
import { ResolveCaseDialog } from '../_components/resolve-case-dialog'

export const metadata = buildMetadata({ title: 'Disputes', noIndex: true })

const FLAG = 'admin.crud.disputes'
const CASES_FLAG = 'ops.v2.cases'
const DISPUTE_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const

const UpdateDisputeSchema = z.object({
  disputeId: z.string().min(1),
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'RESOLVED_SPLIT', 'CLOSED']),
  resolution: z.string().nullable().optional(),
})

const QueueSchema = z.object({
  disputeId: z.string().min(1),
})

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

  await crudAction({
    entity: 'Dispute',
    entityId: disputeId,
    action: 'dispute.update',
    requiredRole: [...DISPUTE_ROLES],
    requiredFlag: FLAG,
    schema: UpdateDisputeSchema,
    input: { disputeId, status, resolution },
    before: existing,
    run: async (_data, tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: status as 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED_CUSTOMER' | 'RESOLVED_PROVIDER' | 'RESOLVED_SPLIT' | 'CLOSED',
          resolution,
          resolvedAt: resolvedStatuses.includes(status) ? new Date() : null,
          resolvedById: resolvedStatuses.includes(status) ? admin.id : null,
        },
      })

      return {
        id: disputeId,
        status,
        resolution,
        resolvedAt: resolvedStatuses.includes(status) ? new Date().toISOString() : null,
        resolvedById: resolvedStatuses.includes(status) ? admin.id : null,
      }
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

  await crudAction({
    entity: 'Dispute',
    entityId: disputeId,
    action: 'dispute.claim',
    requiredRole: [...DISPUTE_ROLES],
    requiredFlag: FLAG,
    schema: QueueSchema,
    input: { disputeId },
    run: async (_input, tx) => {
      await claimOpsQueueItem(tx, {
        queueType: OPS_QUEUE_TYPES.DISPUTE,
        entityId: disputeId,
        claimedById: admin.id,
        claimedByRole: admin.adminRole,
        claimedByLabel: admin.email ?? 'admin',
      })

      return { id: disputeId }
    },
  })

  revalidatePath('/admin/disputes')
  revalidatePath('/admin')
}

async function releaseDisputeAction(formData: FormData) {
  'use server'

  const disputeId = String(formData.get('disputeId') ?? '')
  if (!disputeId) return

  await crudAction({
    entity: 'Dispute',
    entityId: disputeId,
    action: 'dispute.release',
    requiredRole: [...DISPUTE_ROLES],
    requiredFlag: FLAG,
    schema: QueueSchema,
    input: { disputeId },
    run: async (_input, tx) => {
      await releaseOpsQueueItem(tx, {
        queueType: OPS_QUEUE_TYPES.DISPUTE,
        entityId: disputeId,
      })

      return { id: disputeId }
    },
  })

  revalidatePath('/admin/disputes')
  revalidatePath('/admin')
}

export default async function AdminDisputesPage() {
  const admin = await requireAdmin()
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const casesEnabled = await isEnabled(CASES_FLAG, { userId: admin.id })
  const now = new Date()
  const pageWarnings: string[] = []

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
  ).catch((error) => {
    console.error('[admin/disputes] Failed to load queue assignments', error)
    pageWarnings.push('Assignment ownership data is temporarily unavailable.')
    return new Map() as Awaited<ReturnType<typeof listOpsQueueAssignments>>
  })

  const jobById = new Map(jobs.map((job) => [job.id, job]))

  // Fetch open cases for disputes (gated by flag)
  const disputeIds = disputes.map((d) => d.id)
  const rawDisputeCases = casesEnabled
    ? await db.case.findMany({
        where: {
          entityType: 'DISPUTE',
          entityId: { in: disputeIds },
          state: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
          notes: { orderBy: { createdAt: 'desc' } },
        },
      }).catch(() => [])
    : []
  const caseByDispute = new Map(rawDisputeCases.map((c) => [c.entityId, c]))
  const openCount = disputes.filter((dispute) => dispute.status === 'OPEN').length
  const underReviewCount = disputes.filter((dispute) => dispute.status === 'UNDER_REVIEW').length

  return (
    <div className="space-y-6">
      {pageWarnings.length > 0 ? <StaleBanner refreshHref="/admin/disputes" /> : null}
      <div>
        <h1 className="text-xl font-semibold">Disputes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manual review queue for jobs that need intervention.
        </p>
      </div>

      {!crudEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Dispute mutations are disabled. Enable the <code>{FLAG}</code> feature flag to claim or update disputes.
        </div>
      )}

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
            const isActiveDispute = dispute.status === 'OPEN' || dispute.status === 'UNDER_REVIEW'
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

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant={isActiveDispute ? slaToneVariant(getQueueAgeTone('trustRecovery', ageMinutes(dispute.createdAt, now))) : 'outline'}>
                    Age {formatAge(dispute.createdAt, now)}
                  </Badge>
                </div>

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
                      <Button type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
                        {assignment?.claimedById ? 'Take over' : 'Claim'}
                      </Button>
                    </form>
                  ) : (
                    <form action={releaseDisputeAction}>
                      <input type="hidden" name="disputeId" value={dispute.id} />
                      <Button type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
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
                    disabled={!crudEnabled}
                  >
                    Save dispute update
                  </Button>
                </form>

                {casesEnabled && (() => {
                  const activeCase = caseByDispute.get(dispute.id)
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatAge(from: Date, to: Date) {
  const minutes = ageMinutes(from, to)
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

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
