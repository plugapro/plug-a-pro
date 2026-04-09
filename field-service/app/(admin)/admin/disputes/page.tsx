export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'

export const metadata = buildMetadata({ title: 'Disputes', noIndex: true })

const DISPUTE_STYLES: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-700',
  UNDER_REVIEW: 'bg-amber-100 text-amber-700',
  RESOLVED_CUSTOMER: 'bg-blue-100 text-blue-700',
  RESOLVED_PROVIDER: 'bg-green-100 text-green-700',
  RESOLVED_SPLIT: 'bg-purple-100 text-purple-700',
  CLOSED: 'bg-zinc-100 text-zinc-700',
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

  await db.dispute.update({
    where: { id: disputeId },
    data: {
      status: status as 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED_CUSTOMER' | 'RESOLVED_PROVIDER' | 'RESOLVED_SPLIT' | 'CLOSED',
      resolution,
      resolvedAt: resolvedStatuses.includes(status) ? new Date() : null,
      resolvedById: resolvedStatuses.includes(status) ? admin.id : null,
    },
  })
}

export default async function AdminDisputesPage() {
  await requireAdmin()

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
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${DISPUTE_STYLES[dispute.status] ?? DISPUTE_STYLES.OPEN}`}>
                    {dispute.status.replaceAll('_', ' ').toLowerCase()}
                  </span>
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

                <form action={updateDisputeAction} className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
                  <input type="hidden" name="disputeId" value={dispute.id} />
                  <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                    <select
                      name="status"
                      defaultValue={dispute.status}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="OPEN">Open</option>
                      <option value="UNDER_REVIEW">Under review</option>
                      <option value="RESOLVED_CUSTOMER">Resolved for customer</option>
                      <option value="RESOLVED_PROVIDER">Resolved for provider</option>
                      <option value="RESOLVED_SPLIT">Resolved with split outcome</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                    <textarea
                      name="resolution"
                      defaultValue={dispute.resolution ?? ''}
                      placeholder="Add internal resolution notes for this case."
                      className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
                  >
                    Save dispute update
                  </button>
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
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}
