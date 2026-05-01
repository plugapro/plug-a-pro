export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { type LeadUnlockDisputeStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { LEAD_UNLOCK_DISPUTE_REASON_LABELS } from '@/lib/lead-unlock-disputes'
import {
  approveLeadUnlockDisputeFormAction,
  rejectLeadUnlockDisputeFormAction,
} from './actions'

export const metadata = buildMetadata({ title: 'Lead Unlock Disputes', noIndex: true })

const STATUS_OPTIONS: (LeadUnlockDisputeStatus | 'ALL')[] = [
  'ALL',
  'OPEN',
  'APPROVED',
  'REJECTED',
]

const STATUS_STYLES: Record<LeadUnlockDisputeStatus, 'warning' | 'success' | 'danger'> = {
  OPEN: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
}

function cleanStatus(status: string) {
  return status.replaceAll('_', ' ').toLowerCase()
}

function buildHref(status?: string) {
  return status && status !== 'ALL'
    ? `/admin/lead-unlock-disputes?status=${status}`
    : '/admin/lead-unlock-disputes'
}

function messageText(message?: string) {
  switch (message) {
    case 'approved':
      return 'Dispute approved and credits refunded.'
    case 'rejected':
      return 'Dispute rejected without changing wallet balance.'
    case 'approve_failed':
      return 'Could not approve this dispute. It may already be resolved.'
    case 'reject_failed':
      return 'Could not reject this dispute. Check the note and status.'
    default:
      return null
  }
}

export default async function LeadUnlockDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string }>
}) {
  await requireAdmin()
  const { status = 'OPEN', message } = await searchParams
  const statusFilter = STATUS_OPTIONS.includes(status as LeadUnlockDisputeStatus)
    && status !== 'ALL'
    ? status as LeadUnlockDisputeStatus
    : undefined
  const banner = messageText(message)

  const disputes = await db.leadUnlockDispute.findMany({
    where: statusFilter ? { status: statusFilter } : {},
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      leadUnlock: {
        include: {
          lead: {
            include: {
              jobRequest: {
                include: {
                  customer: { select: { name: true, phone: true } },
                  address: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Lead unlock disputes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review provider refund requests for invalid unlocked leads.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/provider-credit-payments">Credit top-ups</Link>
        </Button>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          message?.endsWith('_failed')
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-emerald-300 bg-emerald-50 text-emerald-900'
        }`}>
          {banner}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {STATUS_OPTIONS.map((option) => {
          const active = option === 'ALL' ? !statusFilter : statusFilter === option
          return (
            <Link
              key={option}
              href={buildHref(option)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border/80 bg-card/70 text-muted-foreground hover:bg-accent'
              }`}
            >
              {option === 'ALL' ? 'All' : cleanStatus(option)}
            </Link>
          )
        })}
      </div>

      <div className="space-y-4">
        {disputes.length === 0 ? (
          <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No lead unlock disputes found.
          </div>
        ) : null}

        {disputes.map((dispute) => {
          const jobRequest = dispute.leadUnlock.lead.jobRequest
          const address = jobRequest.address
          const location = address
            ? [normaliseLocationDisplayName(address.suburb), normaliseLocationDisplayName(address.city)].filter(Boolean).join(', ')
            : 'Location on file'

          return (
            <section key={dispute.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{LEAD_UNLOCK_DISPUTE_REASON_LABELS[dispute.reason]}</h2>
                    <Badge variant={STATUS_STYLES[dispute.status]}>{cleanStatus(dispute.status)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {dispute.provider.name} · {dispute.provider.phone}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {dispute.createdAt.toLocaleString('en-ZA', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>

              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Lead</dt>
                  <dd className="font-mono text-xs">{dispute.leadUnlock.leadId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd className="font-medium">{jobRequest.category}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Area</dt>
                  <dd className="font-medium">{location}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd className="font-medium">{jobRequest.customer.name}</dd>
                  <dd className="text-muted-foreground">{jobRequest.customer.phone}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Credits charged</dt>
                  <dd className="font-medium">{dispute.leadUnlock.creditsCharged}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Unlock status</dt>
                  <dd className="font-medium">{cleanStatus(dispute.leadUnlock.status)}</dd>
                </div>
              </dl>

              <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{dispute.notes || 'No notes provided.'}</p>
              </div>

              {dispute.status === 'OPEN' ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <form action={approveLeadUnlockDisputeFormAction} className="space-y-3 rounded-lg border p-3">
                    <input type="hidden" name="disputeId" value={dispute.id} />
                    <p className="text-sm font-medium">Approve refund</p>
                    <p className="text-xs text-muted-foreground">
                      Refunds the original unlock credit split where available.
                    </p>
                    <Textarea name="adminNotes" rows={3} placeholder="Admin note (optional)" />
                    <Button type="submit" className="w-full">Approve and refund</Button>
                  </form>

                  <form action={rejectLeadUnlockDisputeFormAction} className="space-y-3 rounded-lg border p-3">
                    <input type="hidden" name="disputeId" value={dispute.id} />
                    <p className="text-sm font-medium">Reject dispute</p>
                    <p className="text-xs text-muted-foreground">
                      No wallet balance change is made.
                    </p>
                    <Textarea name="adminNotes" rows={3} required placeholder="Reason for rejection" />
                    <Button type="submit" variant="outline" className="w-full">Reject</Button>
                  </form>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  Resolved by {dispute.resolvedBy ?? 'admin'} on{' '}
                  {dispute.resolvedAt?.toLocaleString('en-ZA') ?? 'unknown date'}.
                  {dispute.adminNotes ? (
                    <p className="mt-2 whitespace-pre-wrap">{dispute.adminNotes}</p>
                  ) : null}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
