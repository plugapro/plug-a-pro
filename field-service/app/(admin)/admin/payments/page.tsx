// ─── Admin: Payments ───────────────────────────────────────────────────────────
// Lists all payments with status filter tabs. Supports refund action for PAID payments.

export const dynamic = 'force-dynamic'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { buildMetadata } from '@/lib/metadata'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import type { PaymentCollectionMode, PaymentStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getPaymentAdminMessage } from '@/lib/admin-action-messages'
import { CaseActivityTimeline } from '../_components/case-activity-timeline'
import { CaseNotes } from '../_components/case-notes'
import { ResolveCaseDialog } from '../_components/resolve-case-dialog'

export const metadata = buildMetadata({ title: 'Payments', noIndex: true })

const FLAG = 'admin.crud.payments'
const CASES_FLAG = 'ops.v2.cases'
const REFUND_ROLES = ['FINANCE', 'ADMIN', 'OWNER'] as const
const CLAIM_ROLES = ['OPS', 'FINANCE', 'ADMIN', 'OWNER'] as const

const RefundSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().positive(),
})

const QueueSchema = z.object({
  paymentId: z.string().min(1),
})

// ─── Server Action ────────────────────────────────────────────────────────────

async function issueRefundAction(formData: FormData) {
  'use server'
  const admin = await requireAdmin()
  const paymentId = formData.get('paymentId') as string
  const amount    = Number(formData.get('amount'))

  // Look up the payment to get the bookingId for the lib function
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      amount: true,
      bookingId: true,
      status: true,
      refundedAmount: true,
      refundedAt: true,
    },
  })
  if (!payment) {
    redirect('/admin/payments?message=refund_unavailable')
  }

  const refundedAmount = Number(payment.refundedAmount ?? 0)
  const totalAmount = Number(payment.amount)
  const remainingRefundable = Math.max(0, totalAmount - refundedAmount)

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    remainingRefundable <= 0 ||
    amount > remainingRefundable ||
    !['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)
  ) {
    redirect('/admin/payments?message=invalid_refund_amount')
  }

  const { issueRefund } = await import('@/lib/payments')
  try {
    await crudAction({
      entity: 'Payment',
      entityId: paymentId,
      action: 'payment.refund',
      requiredRole: [...REFUND_ROLES],
      requiredFlag: FLAG,
      schema: RefundSchema,
      input: { paymentId, amount },
      before: payment,
      run: async () => {
        await issueRefund({
          bookingId: payment.bookingId,
          amountCents: Math.round(amount * 100),
        })

        return {
          id: paymentId,
          requestedAmount: amount,
        }
      },
    })
    redirect('/admin/payments?message=refund_issued')
  } catch (err) {
    if (err instanceof CrudActionError) {
      if (err.code === 'FLAG_DISABLED') {
        redirect('/admin/payments')
      }
      if (err.code === 'VALIDATION' || err.code === 'CONFLICT') {
        redirect('/admin/payments?message=invalid_refund_amount')
      }
      if (err.code === 'NOT_FOUND') {
        redirect('/admin/payments?message=refund_unavailable')
      }
    }
    console.error('[admin/payments] Refund failed:', err)
    redirect('/admin/payments?message=refund_failed')
  }
}

async function claimPaymentAction(formData: FormData) {
  'use server'
  const admin = await requireAdmin()
  const paymentId = String(formData.get('paymentId') ?? '')
  if (!paymentId) return

  await crudAction({
    entity: 'Payment',
    entityId: paymentId,
    action: 'payment.claim_follow_up',
    requiredRole: [...CLAIM_ROLES],
    requiredFlag: FLAG,
    schema: QueueSchema,
    input: { paymentId },
    run: async (_input, tx) => {
      await claimOpsQueueItem(tx, {
        queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
        entityId: paymentId,
        claimedById: admin.id,
        claimedByRole: admin.adminRole,
        claimedByLabel: admin.email ?? 'admin',
      })

      return { id: paymentId }
    },
  })

  revalidatePath('/admin/payments')
  revalidatePath('/admin')
}

async function releasePaymentAction(formData: FormData) {
  'use server'
  const paymentId = String(formData.get('paymentId') ?? '')
  if (!paymentId) return

  await crudAction({
    entity: 'Payment',
    entityId: paymentId,
    action: 'payment.release_follow_up',
    requiredRole: [...CLAIM_ROLES],
    requiredFlag: FLAG,
    schema: QueueSchema,
    input: { paymentId },
    run: async (_input, tx) => {
      await releaseOpsQueueItem(tx, {
        queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
        entityId: paymentId,
      })

      return { id: paymentId }
    },
  })

  revalidatePath('/admin/payments')
  revalidatePath('/admin')
}

// ─── Status badge styling ─────────────────────────────────────────────────────

const STATUS_STYLES: Record<PaymentStatus, 'warning' | 'info' | 'success' | 'danger' | 'neutral'> = {
  PENDING:            'warning',
  AUTHORISED:         'info',
  PAID:               'success',
  FAILED:             'danger',
  REFUNDED:           'neutral',
  PARTIALLY_REFUNDED: 'neutral',
}

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING:            'Pending',
  AUTHORISED:         'Authorised',
  PAID:               'Paid',
  FAILED:             'Failed',
  REFUNDED:           'Refunded',
  PARTIALLY_REFUNDED: 'Part. Refunded',
}

const FILTER_OPTIONS: { value: PaymentStatus | 'ALL'; label: string }[] = [
  { value: 'ALL',     label: 'All' },
  { value: 'PAID',    label: 'Paid' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED',  label: 'Failed' },
]

const COLLECTION_LABEL: Record<PaymentCollectionMode, string> = {
  OFFLINE_RECORDED: 'Offline / recorded only',
  PLATFORM_CHECKOUT: 'Platform checkout',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string }>
}) {
  const admin = await requireAdmin()
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const casesEnabled = await isEnabled(CASES_FLAG, { userId: admin.id })
  const { status, message } = await searchParams
  const banner = getPaymentAdminMessage(message)

  const validStatuses: PaymentStatus[] = ['PENDING', 'AUTHORISED', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']
  const statusFilter = validStatuses.includes(status as PaymentStatus)
    ? (status as PaymentStatus)
    : undefined

  const payments = await db.payment.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                select: {
                  title: true,
                  customer: { select: { name: true, phone: true } },
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

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
    payments.map((payment) => payment.id),
  )

  const activeCases = casesEnabled
    ? await db.case.findMany({
        where: {
          entityType: 'PAYMENT',
          entityId: { in: payments.map((p) => p.id) },
          state: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        include: {
          events: { orderBy: { createdAt: 'desc' }, take: 50 },
          notes: { orderBy: { createdAt: 'desc' } },
        },
      }).catch(() => [])
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Payments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {payments.length} payments. Offline-recorded rows are booking trace records only until the money is actually collected and marked paid.
        </p>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${banner.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {banner.text}
        </div>
      ) : null}

      {!crudEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Payment mutations are disabled. Enable the <code>{FLAG}</code> feature flag to claim follow-ups or issue refunds.
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {FILTER_OPTIONS.map((opt) => {
          const active = opt.value === 'ALL' ? !statusFilter : opt.value === statusFilter
          return (
            <a
              key={opt.value}
              href={opt.value === 'ALL' ? '/admin/payments' : `/admin/payments?status=${opt.value}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(37,99,235,0.18)]'
                  : 'border border-border/80 bg-card/70 text-muted-foreground hover:bg-accent'
              }`}
            >
              {opt.label}
            </a>
          )
        })}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Ref</th>
              <th className="text-left px-4 py-3 font-medium">Customer</th>
              <th className="text-left px-4 py-3 font-medium">Job Request</th>
              <th className="text-left px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Collection</th>
              <th className="text-left px-4 py-3 font-medium">PSP Ref</th>
              <th className="text-left px-4 py-3 font-medium">Paid At</th>
              <th className="text-left px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  No payments found
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const customer = p.booking.match?.jobRequest.customer
              const jobTitle = p.booking.match?.jobRequest.title ?? '—'
              const assignment = assignments.get(p.id)
              const claimedByCurrentUser = assignment?.claimedById === admin.id
              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{p.id.slice(-8).toUpperCase()}</td>
                  <td className="px-4 py-3">
                    <p>{customer?.name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{customer?.phone ?? ''}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{jobTitle}</td>
                  <td className="px-4 py-3 font-medium">
                    R {Number(p.amount).toFixed(2)}
                    {p.refundedAmount && (
                      <p className="text-xs text-muted-foreground">
                        Refunded: R {Number(p.refundedAmount).toFixed(2)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_STYLES[p.status]}>
                      {STATUS_LABEL[p.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {COLLECTION_LABEL[p.collectionMode]}
                    {p.pspProvider && (
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.pspProvider}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {p.pspReference ? p.pspReference.slice(-12) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.paidAt
                      ? p.paidAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                      {formatOpsQueueOwnerLabel(assignment, admin.id)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {!claimedByCurrentUser ? (
                        <form action={claimPaymentAction}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <Button type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
                            {assignment?.claimedById ? 'Take over' : 'Claim'}
                          </Button>
                        </form>
                      ) : (
                        <form action={releasePaymentAction}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <Button type="submit" variant="outline" size="sm" disabled={!crudEnabled}>
                            Release
                          </Button>
                        </form>
                      )}
                      {p.status === 'PAID' && (
                        <form action={issueRefundAction} className="flex items-center gap-1">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <Input
                            type="number"
                            name="amount"
                            min="0.01"
                            max={Number(p.amount)}
                            step="0.01"
                            defaultValue={Number(p.amount)}
                            className="h-8 w-24 rounded-lg text-xs"
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            disabled={!crudEnabled}
                            onClick={(e) => {
                              if (!confirm('Issue refund for this payment?')) e.preventDefault()
                            }}
                          >
                            Refund
                          </Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {casesEnabled && activeCases.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Open payment cases</h2>
          {activeCases.map((activeCase) => (
            <div key={activeCase.id} className="rounded-xl border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-muted-foreground">{activeCase.entityId.slice(-8).toUpperCase()}</p>
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
          ))}
        </div>
      )}
    </div>
  )
}
