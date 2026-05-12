'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.payments'

const ReconcilePaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const WriteOffPaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type ReconcileInput = z.infer<typeof ReconcilePaymentSchema>
type WriteOffInput = z.infer<typeof WriteOffPaymentSchema>

export async function reconcilePaymentAction(input: ReconcileInput) {
  const before = await db.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, amount: true, collectionMode: true },
  })

  const result = await crudAction<ReconcileInput, { id: string }>({
    entity: AUDIT_ENTITY.PAYMENT,
    entityId: input.paymentId,
    action: 'payment.reconcile',
    requiredRole: ['OPS', 'FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: ReconcilePaymentSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: data.paymentId },
        select: { id: true, status: true },
      })
      if (!payment) throw new CrudActionError('NOT_FOUND', `Payment ${data.paymentId} not found.`)
      if (payment.status === 'PAID' || payment.status === 'REFUNDED') {
        throw new CrudActionError('CONFLICT', `Cannot reconcile a ${payment.status} payment.`)
      }
      await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          collectionMode: 'OFFLINE_RECORDED',
        },
      })
      return { id: data.paymentId }
    },
  })
  revalidatePath('/admin/payments')
  return result
}

export async function writeOffPaymentAction(input: WriteOffInput) {
  const before = await db.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, amount: true },
  })

  const result = await crudAction<WriteOffInput, { id: string }>({
    entity: AUDIT_ENTITY.PAYMENT,
    entityId: input.paymentId,
    action: 'payment.write_off',
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: WriteOffPaymentSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: data.paymentId },
        select: { id: true, status: true },
      })
      if (!payment) throw new CrudActionError('NOT_FOUND', `Payment ${data.paymentId} not found.`)
      if (payment.status === 'PAID' || payment.status === 'REFUNDED') {
        throw new CrudActionError('CONFLICT', `Cannot write off a ${payment.status} payment.`)
      }
      await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          status: 'FAILED',
          failureReason: data.reason,
        },
      })
      return { id: data.paymentId }
    },
  })
  revalidatePath('/admin/payments')
  return result
}

export async function reconcilePaymentFromFormAction(formData: FormData) {
  try {
    return await reconcilePaymentAction({
      paymentId: formData.get('paymentId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to reconcile payment' }
  }
}

// ─── Moved from payments/page.tsx ─────────────────────────────────────────────

const RefundSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.number().positive(),
})

const QueueSchema = z.object({
  paymentId: z.string().min(1),
})

const REFUND_ROLES = ['FINANCE', 'ADMIN', 'OWNER'] as const
const CLAIM_ROLES = ['OPS', 'FINANCE', 'ADMIN', 'OWNER'] as const

export async function issueRefundAction(formData: FormData) {
  const { requireAdmin } = await import('@/lib/auth')
  await requireAdmin()
  const paymentId = formData.get('paymentId') as string
  const amount    = Number(formData.get('amount'))

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
    // redirect() throws a NEXT_REDIRECT sentinel — must re-throw before other checks
    if (
      typeof err === 'object' &&
      err !== null &&
      'digest' in err &&
      typeof (err as { digest?: string }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err
    }
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

export async function claimPaymentAction(formData: FormData) {
  try {
    const { requireAdmin } = await import('@/lib/auth')
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
        const { claimOpsQueueItem, OPS_QUEUE_TYPES } = await import('@/lib/ops-queue')
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
  } catch (err) {
    if (err instanceof CrudActionError) return
    throw err
  }
}

export async function releasePaymentAction(formData: FormData) {
  try {
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
        const { releaseOpsQueueItem, OPS_QUEUE_TYPES } = await import('@/lib/ops-queue')
        await releaseOpsQueueItem(tx, {
          queueType: OPS_QUEUE_TYPES.PAYMENT_FOLLOW_UP,
          entityId: paymentId,
        })

        return { id: paymentId }
      },
    })

    revalidatePath('/admin/payments')
    revalidatePath('/admin')
  } catch (err) {
    if (err instanceof CrudActionError) return
    throw err
  }
}

export async function writeOffPaymentFromFormAction(formData: FormData) {
  try {
    return await writeOffPaymentAction({
      paymentId: formData.get('paymentId') as string,
      reason: ((formData.get('reason') as string) ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to write off payment' }
  }
}
