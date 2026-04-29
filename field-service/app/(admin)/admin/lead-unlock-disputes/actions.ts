'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { requireAdmin } from '@/lib/auth'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { db } from '@/lib/db'
import {
  LeadUnlockDisputeError,
  approveLeadUnlockDisputeInTransaction,
  rejectLeadUnlockDisputeInTransaction,
} from '@/lib/lead-unlock-disputes'

const FLAG = 'admin.crud.payments'
const DISPUTE_ROLES = ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'] as const

const ResolveLeadUnlockDisputeSchema = z.object({
  disputeId: z.string().min(1),
  adminNotes: z.string().max(1_000).optional(),
})

const RejectLeadUnlockDisputeSchema = ResolveLeadUnlockDisputeSchema.extend({
  adminNotes: z.string().min(1).max(1_000),
})

type ResolveLeadUnlockDisputeInput = z.infer<typeof ResolveLeadUnlockDisputeSchema>
type RejectLeadUnlockDisputeInput = z.infer<typeof RejectLeadUnlockDisputeSchema>

function adminLeadUnlockDisputesPath(message?: string) {
  return message
    ? `/admin/lead-unlock-disputes?message=${message}`
    : '/admin/lead-unlock-disputes'
}

function toCrudConflict(error: unknown): never {
  if (error instanceof LeadUnlockDisputeError) {
    if (error.code === 'NOT_FOUND') {
      throw new CrudActionError('NOT_FOUND', error.message)
    }
    throw new CrudActionError('CONFLICT', error.message)
  }

  throw error
}

export async function approveLeadUnlockDisputeAction(input: ResolveLeadUnlockDisputeInput) {
  const admin = await requireAdmin()
  const before = await db.leadUnlockDispute.findUnique({
    where: { id: input.disputeId },
  })

  const result = await crudAction<ResolveLeadUnlockDisputeInput, { id: string; status: string; ledgerEntryIds: string[] }>({
    entity: AUDIT_ENTITY.LEAD_UNLOCK_DISPUTE,
    entityId: input.disputeId,
    action: 'lead_unlock_dispute.approve_refund',
    requiredRole: [...DISPUTE_ROLES],
    requiredFlag: FLAG,
    schema: ResolveLeadUnlockDisputeSchema,
    input,
    before: before ?? undefined,
    reason: input.adminNotes || 'Approved invalid lead refund',
    run: async (data, tx) => {
      try {
        const result = await approveLeadUnlockDisputeInTransaction(
          tx,
          data.disputeId,
          admin.adminUserId ?? admin.id,
          data.adminNotes,
        )
        return {
          id: result.dispute.id,
          status: result.dispute.status,
          ledgerEntryIds: result.ledgerEntries.map((entry) => entry.id),
        }
      } catch (error) {
        toCrudConflict(error)
      }
    },
  })

  revalidatePath('/admin/lead-unlock-disputes')
  return result
}

export async function rejectLeadUnlockDisputeAction(input: RejectLeadUnlockDisputeInput) {
  const admin = await requireAdmin()
  const before = await db.leadUnlockDispute.findUnique({
    where: { id: input.disputeId },
  })

  const result = await crudAction<RejectLeadUnlockDisputeInput, { id: string; status: string }>({
    entity: AUDIT_ENTITY.LEAD_UNLOCK_DISPUTE,
    entityId: input.disputeId,
    action: 'lead_unlock_dispute.reject',
    requiredRole: [...DISPUTE_ROLES],
    requiredFlag: FLAG,
    schema: RejectLeadUnlockDisputeSchema,
    input,
    before: before ?? undefined,
    reason: input.adminNotes,
    run: async (data, tx) => {
      try {
        const result = await rejectLeadUnlockDisputeInTransaction(
          tx,
          data.disputeId,
          admin.adminUserId ?? admin.id,
          data.adminNotes,
        )
        return {
          id: result.dispute.id,
          status: result.dispute.status,
        }
      } catch (error) {
        toCrudConflict(error)
      }
    },
  })

  revalidatePath('/admin/lead-unlock-disputes')
  return result
}

export async function approveLeadUnlockDisputeFormAction(formData: FormData) {
  const disputeId = String(formData.get('disputeId') ?? '')
  const adminNotes = String(formData.get('adminNotes') ?? '').trim() || undefined

  try {
    await approveLeadUnlockDisputeAction({ disputeId, adminNotes })
  } catch {
    redirect(adminLeadUnlockDisputesPath('approve_failed'))
  }

  redirect(adminLeadUnlockDisputesPath('approved'))
}

export async function rejectLeadUnlockDisputeFormAction(formData: FormData) {
  const disputeId = String(formData.get('disputeId') ?? '')
  const adminNotes = String(formData.get('adminNotes') ?? '').trim()

  try {
    await rejectLeadUnlockDisputeAction({ disputeId, adminNotes })
  } catch {
    redirect(adminLeadUnlockDisputesPath('reject_failed'))
  }

  redirect(adminLeadUnlockDisputesPath('rejected'))
}
