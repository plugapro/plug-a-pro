'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.disputes'

const ResolveDisputeSchema = z.object({
  disputeId: z.string().min(1),
  outcome: z.enum(['RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'RESOLVED_SPLIT', 'CLOSED']),
  resolution: z.string().min(1).max(1000),
})

const EscalateDisputeSchema = z.object({
  disputeId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type ResolveInput = z.infer<typeof ResolveDisputeSchema>
type EscalateInput = z.infer<typeof EscalateDisputeSchema>

export async function resolveDisputeAction(input: ResolveInput) {
  const before = await db.dispute.findUnique({
    where: { id: input.disputeId },
    select: { id: true, status: true, resolution: true },
  })

  const result = await crudAction<ResolveInput, { id: string }>({
    entity: AUDIT_ENTITY.DISPUTE,
    entityId: input.disputeId,
    action: 'dispute.resolve',
    requiredRole: ['OPS', 'TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: ResolveDisputeSchema,
    input,
    before: before ?? undefined,
    reason: input.resolution,
    run: async (data, tx) => {
      const dispute = await tx.dispute.findUnique({
        where: { id: data.disputeId },
        select: { id: true, status: true },
      })
      if (!dispute) throw new CrudActionError('NOT_FOUND', `Dispute ${data.disputeId} not found.`)
      if (
        dispute.status === 'RESOLVED_CUSTOMER' ||
        dispute.status === 'RESOLVED_PROVIDER' ||
        dispute.status === 'RESOLVED_SPLIT' ||
        dispute.status === 'CLOSED'
      ) {
        throw new CrudActionError('CONFLICT', `Dispute is already ${dispute.status}.`)
      }
      await tx.dispute.update({
        where: { id: data.disputeId },
        data: {
          status: data.outcome,
          resolution: data.resolution,
          resolvedAt: new Date(),
        },
      })
      return { id: data.disputeId }
    },
  })
  revalidatePath('/admin/disputes')
  return result
}

export async function escalateDisputeAction(input: EscalateInput) {
  const before = await db.dispute.findUnique({
    where: { id: input.disputeId },
    select: { id: true, status: true },
  })

  const result = await crudAction<EscalateInput, { id: string }>({
    entity: AUDIT_ENTITY.DISPUTE,
    entityId: input.disputeId,
    action: 'dispute.escalate',
    requiredRole: ['OPS', 'TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: EscalateDisputeSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const dispute = await tx.dispute.findUnique({
        where: { id: data.disputeId },
        select: { id: true, status: true },
      })
      if (!dispute) throw new CrudActionError('NOT_FOUND', `Dispute ${data.disputeId} not found.`)
      if (dispute.status !== 'OPEN') {
        throw new CrudActionError('CONFLICT', `Cannot escalate a ${dispute.status} dispute.`)
      }
      // UNDER_REVIEW is the correct escalation target (no ESCALATED status in enum)
      await tx.dispute.update({
        where: { id: data.disputeId },
        data: { status: 'UNDER_REVIEW' },
      })
      return { id: data.disputeId }
    },
  })
  revalidatePath('/admin/disputes')
  return result
}

export async function resolveDisputeFromFormAction(formData: FormData) {
  try {
    const outcome = formData.get('outcome') as ResolveInput['outcome']
    return await resolveDisputeAction({
      disputeId: formData.get('disputeId') as string,
      outcome,
      resolution: (formData.get('resolution') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to resolve dispute' }
  }
}
