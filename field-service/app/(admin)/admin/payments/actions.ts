'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
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
