// ─── Admin: Payments ───────────────────────────────────────────────────────────
// Lists all payments with status filter tabs. Supports refund action for PAID payments.

export const dynamic = 'force-dynamic'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { recordAuditLog } from '@/lib/audit'
import { buildMetadata } from '@/lib/metadata'
import type { PaymentCollectionMode, PaymentStatus } from '@prisma/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const metadata = buildMetadata({ title: 'Payments', noIndex: true })

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
      bookingId: true,
      status: true,
      refundedAmount: true,
      refundedAt: true,
    },
  })
  if (!payment) return

  const { issueRefund } = await import('@/lib/payments')
  try {
    await issueRefund({
      bookingId:   payment.bookingId,
      amountCents: Math.round(amount * 100),
    })

    await recordAuditLog({
      actorId: admin.id,
      actorRole: admin.role,
      action: 'payment.refund',
      entityType: 'payment',
      entityId: paymentId,
      before: payment,
      after: {
        requestedAmount: amount,
      },
    })
  } catch (err) {
    console.error('[admin/payments] Refund failed:', err)
  }

  revalidatePath('/admin/payments')
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
  searchParams: Promise<{ status?: string }>
}) {
  await requireAdmin()
  const { status } = await searchParams

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Payments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {payments.length} payments. Offline-recorded rows are booking trace records only until the money is actually collected and marked paid.
        </p>
      </div>

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
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  No payments found
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const customer = p.booking.match?.jobRequest.customer
              const jobTitle = p.booking.match?.jobRequest.title ?? '—'
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
                          onClick={(e) => {
                            if (!confirm('Issue refund for this payment?')) e.preventDefault()
                          }}
                        >
                          Refund
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
