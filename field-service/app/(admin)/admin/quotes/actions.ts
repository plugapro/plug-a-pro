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

// ─── WS-6a: Approve / Decline / Send / Revise ────────────────────────────────

const SEND_FLAG = 'admin.quotes.send'

// ── Approve ───────────────────────────────────────────────────────────────────

const ApproveQuoteSchema = z.object({ quoteId: z.string().min(1) })
type ApproveInput = z.infer<typeof ApproveQuoteSchema>

export async function approveQuoteAction(input: ApproveInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, amount: true },
  })
  const result = await crudAction<ApproveInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.admin_approve',
    requiredRole: ['OPS', 'FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: SEND_FLAG,
    schema: ApproveQuoteSchema,
    input,
    before: before ?? undefined,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status === 'APPROVED') throw new CrudActionError('CONFLICT', 'Quote is already approved.')
      if (quote.status !== 'PENDING' && quote.status !== 'REVISED') {
        throw new CrudActionError('CONFLICT', `Cannot approve a ${quote.status} quote.`)
      }
      await tx.quote.update({ where: { id: data.quoteId }, data: { status: 'APPROVED', approvedAt: new Date() } })
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function approveQuoteFromFormAction(formData: FormData) {
  try {
    const quoteId = formData.get('quoteId')
    if (typeof quoteId !== 'string' || !quoteId) return { ok: false as const, error: 'Invalid quote ID' }
    return await approveQuoteAction({ quoteId })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to approve quote' }
  }
}

// ── Decline ───────────────────────────────────────────────────────────────────

const DeclineQuoteSchema = z.object({ quoteId: z.string().min(1), reason: z.string().min(1).max(500) })
type DeclineInput = z.infer<typeof DeclineQuoteSchema>

export async function declineQuoteAction(input: DeclineInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, amount: true },
  })
  const result = await crudAction<DeclineInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.admin_decline',
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: SEND_FLAG,
    schema: DeclineQuoteSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status === 'DECLINED') throw new CrudActionError('CONFLICT', 'Quote is already declined.')
      if (quote.status === 'APPROVED') throw new CrudActionError('CONFLICT', 'Cannot decline an approved quote.')
      await tx.quote.update({
        where: { id: data.quoteId },
        data: { status: 'DECLINED', declinedAt: new Date(), notes: data.reason },
      })
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function declineQuoteFromFormAction(formData: FormData) {
  try {
    const quoteId = formData.get('quoteId')
    if (typeof quoteId !== 'string' || !quoteId) return { ok: false as const, error: 'Invalid quote ID' }
    const reason = (formData.get('reason') as string ?? '').trim()
    if (!reason) return { ok: false as const, error: 'Reason is required' }
    return await declineQuoteAction({ quoteId, reason })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to decline quote' }
  }
}

// ── Send (notify customer) ────────────────────────────────────────────────────
// QuoteStatus has no DRAFT value. This action stamps approvalWhatsappSentAt as
// the idempotency guard and logs a TODO until notifyQuoteReady() is wired.

const SendQuoteSchema = z.object({ quoteId: z.string().min(1) })
type SendInput = z.infer<typeof SendQuoteSchema>

export async function sendQuoteAction(input: SendInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, amount: true, approvalWhatsappSentAt: true },
  })
  const result = await crudAction<SendInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.admin_send',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: SEND_FLAG,
    schema: SendQuoteSchema,
    input,
    before: before ?? undefined,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true, approvalWhatsappSentAt: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status === 'APPROVED' || quote.status === 'DECLINED' || quote.status === 'EXPIRED') {
        throw new CrudActionError('CONFLICT', `Cannot send a ${quote.status} quote.`)
      }
      if (!quote.approvalWhatsappSentAt) {
        // TODO: call notifyQuoteReady(quoteId) once implemented
        console.info(`[quote.admin_send] TODO: notify customer of quote ${data.quoteId}`)
        await tx.quote.update({
          where: { id: data.quoteId },
          data: { approvalWhatsappSentAt: new Date() },
        })
      }
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function sendQuoteFromFormAction(formData: FormData) {
  try {
    const quoteId = formData.get('quoteId')
    if (typeof quoteId !== 'string' || !quoteId) return { ok: false as const, error: 'Invalid quote ID' }
    return await sendQuoteAction({ quoteId })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to send quote' }
  }
}

// ── Revise ────────────────────────────────────────────────────────────────────

const ReviseQuoteSchema = z.object({
  quoteId: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  notes: z.string().optional(),
})
type ReviseInput = z.infer<typeof ReviseQuoteSchema>

export async function reviseQuoteAction(input: ReviseInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, amount: true },
  })
  const result = await crudAction<ReviseInput, { id: string; amount: number }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.admin_revise',
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: SEND_FLAG,
    schema: ReviseQuoteSchema,
    input,
    before: before ?? undefined,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status === 'APPROVED' || quote.status === 'DECLINED' || quote.status === 'EXPIRED') {
        throw new CrudActionError('CONFLICT', `Cannot revise a ${quote.status} quote.`)
      }
      await tx.quote.update({
        where: { id: data.quoteId },
        data: {
          status: 'REVISED',
          amount: data.amount,
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
      })
      return { id: data.quoteId, amount: data.amount }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function reviseQuoteFromFormAction(formData: FormData) {
  try {
    const quoteId = formData.get('quoteId')
    if (typeof quoteId !== 'string' || !quoteId) return { ok: false as const, error: 'Invalid quote ID' }
    const rawAmount = formData.get('amount')
    const amount = rawAmount !== null ? Number(rawAmount) : NaN
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, error: 'Amount must be a positive number' }
    const description = formData.get('description')
    const notes = formData.get('notes')
    return await reviseQuoteAction({
      quoteId,
      amount,
      description: typeof description === 'string' ? description : undefined,
      notes: typeof notes === 'string' ? notes : undefined,
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to revise quote' }
  }
}
