'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.quotes'

const VoidQuoteSchema = z.object({
  quoteId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const ExpireQuoteSchema = z.object({
  quoteId: z.string().min(1),
})

type VoidInput = z.infer<typeof VoidQuoteSchema>
type ExpireInput = z.infer<typeof ExpireQuoteSchema>

export async function voidQuoteAction(input: VoidInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, amount: true },
  })

  const result = await crudAction<VoidInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.void',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: VoidQuoteSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status === 'APPROVED' || quote.status === 'DECLINED') {
        throw new CrudActionError('CONFLICT', `Cannot void a ${quote.status} quote.`)
      }
      await tx.quote.update({
        where: { id: data.quoteId },
        data: { status: 'DECLINED', notes: data.reason },
      })
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function expireQuoteAction(input: ExpireInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, validUntil: true },
  })

  const result = await crudAction<ExpireInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.expire',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: ExpireQuoteSchema,
    input,
    before: before ?? undefined,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status !== 'PENDING' && quote.status !== 'REVISED') {
        throw new CrudActionError('CONFLICT', `Cannot expire a ${quote.status} quote.`)
      }
      await tx.quote.update({
        where: { id: data.quoteId },
        data: { status: 'EXPIRED', validUntil: new Date() },
      })
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function voidQuoteFromFormAction(formData: FormData) {
  try {
    return await voidQuoteAction({
      quoteId: formData.get('quoteId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to void quote' }
  }
}

export async function claimQuoteFromFormAction(formData: FormData) {
  try {
    const { requireAdmin } = await import('@/lib/auth')
    const activeAdmin = await requireAdmin()
    const quoteId = formData.get('quoteId')
    if (typeof quoteId !== 'string' || !quoteId) {
      return { ok: false as const, error: 'Invalid quote ID' }
    }
    await crudAction({
      entity: AUDIT_ENTITY.QUOTE,
      action: 'quote.claim',
      requiredRole: ['OPS', 'ADMIN', 'OWNER'],
      requiredFlag: FLAG,
      schema: z.object({ quoteId: z.string().min(1) }),
      input: { quoteId },
      run: async ({ quoteId: qId }, tx) => {
        const { claimOpsQueueItem, OPS_QUEUE_TYPES } = await import('@/lib/ops-queue')
        await claimOpsQueueItem(tx, {
          queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
          entityId: qId,
          claimedById: activeAdmin.id,
          claimedByRole: activeAdmin.adminRole,
          claimedByLabel: activeAdmin.email ?? 'admin',
        })
        return { id: qId, claimedById: activeAdmin.id }
      },
    })
    revalidatePath('/admin/quotes')
    revalidatePath('/admin')
    return { ok: true as const, message: 'Quote claimed' }
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to claim quote' }
  }
}

export async function releaseQuoteFromFormAction(formData: FormData) {
  try {
    const quoteId = formData.get('quoteId')
    if (typeof quoteId !== 'string' || !quoteId) {
      return { ok: false as const, error: 'Invalid quote ID' }
    }
    await crudAction({
      entity: AUDIT_ENTITY.QUOTE,
      action: 'quote.release',
      requiredRole: ['OPS', 'ADMIN', 'OWNER'],
      requiredFlag: FLAG,
      schema: z.object({ quoteId: z.string().min(1) }),
      input: { quoteId },
      run: async ({ quoteId: qId }, tx) => {
        const { releaseOpsQueueItem, OPS_QUEUE_TYPES } = await import('@/lib/ops-queue')
        await releaseOpsQueueItem(tx, {
          queueType: OPS_QUEUE_TYPES.QUOTE_APPROVAL,
          entityId: qId,
        })
        return { id: qId, released: true }
      },
    })
    revalidatePath('/admin/quotes')
    revalidatePath('/admin')
    return { ok: true as const, message: 'Quote released' }
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to release quote' }
  }
}
