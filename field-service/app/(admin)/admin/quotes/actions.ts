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
