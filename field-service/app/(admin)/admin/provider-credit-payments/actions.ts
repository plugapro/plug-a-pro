'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { requireAdmin } from '@/lib/auth'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { db } from '@/lib/db'
import {
  ProviderCreditReconciliationError,
  creditPaymentIntentInTransaction,
  reconcilePaymentIntentInTransaction,
} from '@/lib/provider-credit-reconciliation'

const FLAG = 'admin.crud.payments'
const RECONCILE_ROLES = ['OPS', 'FINANCE', 'ADMIN', 'OWNER'] as const

const ReconcileTopUpSchema = z.object({
  paymentIntentId: z.string().min(1),
  bankStatementReference: z.string().min(1).max(120),
  statementAmountCents: z.number().int().positive().optional(),
  adminNote: z.string().max(1_000).optional(),
})

const CreditTopUpSchema = z.object({
  paymentIntentId: z.string().min(1),
  adminNote: z.string().max(1_000).optional(),
})

const FailTopUpSchema = z.object({
  paymentIntentId: z.string().min(1),
  adminNote: z.string().min(1).max(1_000),
})

const AddNoteSchema = z.object({
  paymentIntentId: z.string().min(1),
  adminNote: z.string().min(1).max(1_000),
})

type ReconcileTopUpInput = z.infer<typeof ReconcileTopUpSchema>
type CreditTopUpInput = z.infer<typeof CreditTopUpSchema>
type FailTopUpInput = z.infer<typeof FailTopUpSchema>
type AddNoteInput = z.infer<typeof AddNoteSchema>

function adminCreditPaymentsPath(paymentIntentId?: string, message?: string) {
  const base = paymentIntentId
    ? `/admin/provider-credit-payments/${paymentIntentId}`
    : '/admin/provider-credit-payments'
  return message ? `${base}?message=${message}` : base
}

function appendAdminNote(existing: string | null, next: string) {
  const clean = next.trim()
  if (!clean) return existing
  return existing ? `${existing}\n${clean}` : clean
}

function toActionConflict(error: unknown): never {
  if (error instanceof ProviderCreditReconciliationError) {
    if (error.code === 'NOT_FOUND') {
      throw new CrudActionError('NOT_FOUND', error.message)
    }
    throw new CrudActionError('CONFLICT', error.message)
  }
  throw error
}

export async function reconcileTopUpIntentAction(input: ReconcileTopUpInput) {
  const admin = await requireAdmin()
  const before = await db.paymentIntent.findUnique({
    where: { id: input.paymentIntentId },
  })

  const result = await crudAction<ReconcileTopUpInput, { id: string; status: string }>({
    entity: AUDIT_ENTITY.PAYMENT_INTENT,
    entityId: input.paymentIntentId,
    action: 'provider_credit_payment_intent.reconcile',
    requiredRole: [...RECONCILE_ROLES],
    requiredFlag: FLAG,
    schema: ReconcileTopUpSchema,
    input,
    before: before ?? undefined,
    reason: input.adminNote || input.bankStatementReference,
    run: async (data, tx) => {
      try {
        const { intent } = await reconcilePaymentIntentInTransaction(
          tx,
          data.paymentIntentId,
          admin.adminUserId ?? admin.id,
          data.bankStatementReference,
          {
            statementAmountCents: data.statementAmountCents,
            adminNote: data.adminNote,
          },
        )
        return { id: intent.id, status: intent.status }
      } catch (error) {
        toActionConflict(error)
      }
    },
  })

  revalidatePath('/admin/provider-credit-payments')
  revalidatePath(`/admin/provider-credit-payments/${input.paymentIntentId}`)
  return result
}

export async function creditTopUpIntentAction(input: CreditTopUpInput) {
  const admin = await requireAdmin()
  const before = await db.paymentIntent.findUnique({
    where: { id: input.paymentIntentId },
  })

  const result = await crudAction<CreditTopUpInput, { id: string; status: string; ledgerEntryId: string }>({
    entity: AUDIT_ENTITY.PAYMENT_INTENT,
    entityId: input.paymentIntentId,
    action: 'provider_credit_payment_intent.credit_wallet',
    requiredRole: [...RECONCILE_ROLES],
    requiredFlag: FLAG,
    schema: CreditTopUpSchema,
    input,
    before: before ?? undefined,
    reason: input.adminNote || 'Confirmed funds and credited provider wallet',
    run: async (data, tx) => {
      try {
        const result = await creditPaymentIntentInTransaction(
          tx,
          data.paymentIntentId,
          admin.adminUserId ?? admin.id,
          { adminNote: data.adminNote },
        )
        return {
          id: result.intent.id,
          status: result.intent.status,
          ledgerEntryId: result.ledgerEntries[0]?.id ?? '',
        }
      } catch (error) {
        toActionConflict(error)
      }
    },
  })

  revalidatePath('/admin/provider-credit-payments')
  revalidatePath(`/admin/provider-credit-payments/${input.paymentIntentId}`)
  const { notifyProviderPaymentCredited } = await import('@/lib/provider-wallet-notifications')
  notifyProviderPaymentCredited(input.paymentIntentId).catch((error: unknown) => {
    console.error('[provider-credit-payments/actions] payment credited WhatsApp notification failed', {
      paymentIntentId: input.paymentIntentId,
      error,
    })
  })
  return result
}

export async function failTopUpIntentAction(input: FailTopUpInput) {
  const before = await db.paymentIntent.findUnique({
    where: { id: input.paymentIntentId },
  })

  const result = await crudAction<FailTopUpInput, { id: string; status: string }>({
    entity: AUDIT_ENTITY.PAYMENT_INTENT,
    entityId: input.paymentIntentId,
    action: 'provider_credit_payment_intent.mark_failed',
    requiredRole: [...RECONCILE_ROLES],
    requiredFlag: FLAG,
    schema: FailTopUpSchema,
    input,
    before: before ?? undefined,
    reason: input.adminNote,
    run: async (data, tx) => {
      const intent = await tx.paymentIntent.findUnique({
        where: { id: data.paymentIntentId },
        select: { id: true, status: true, adminNote: true },
      })
      if (!intent) throw new CrudActionError('NOT_FOUND', `Payment intent ${data.paymentIntentId} not found.`)
      if (intent.status === 'CREDITED') {
        throw new CrudActionError('CONFLICT', 'Credited payment intents cannot be marked failed.')
      }

      const updated = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'FAILED',
          adminNote: appendAdminNote(intent.adminNote, data.adminNote),
        },
      })
      return { id: updated.id, status: updated.status }
    },
  })

  revalidatePath('/admin/provider-credit-payments')
  revalidatePath(`/admin/provider-credit-payments/${input.paymentIntentId}`)
  return result
}

export async function addTopUpIntentNoteAction(input: AddNoteInput) {
  const before = await db.paymentIntent.findUnique({
    where: { id: input.paymentIntentId },
  })

  const result = await crudAction<AddNoteInput, { id: string }>({
    entity: AUDIT_ENTITY.PAYMENT_INTENT,
    entityId: input.paymentIntentId,
    action: 'provider_credit_payment_intent.add_note',
    requiredRole: [...RECONCILE_ROLES],
    requiredFlag: FLAG,
    schema: AddNoteSchema,
    input,
    before: before ?? undefined,
    reason: input.adminNote,
    run: async (data, tx) => {
      const intent = await tx.paymentIntent.findUnique({
        where: { id: data.paymentIntentId },
        select: { id: true, adminNote: true },
      })
      if (!intent) throw new CrudActionError('NOT_FOUND', `Payment intent ${data.paymentIntentId} not found.`)

      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { adminNote: appendAdminNote(intent.adminNote, data.adminNote) },
      })
      return { id: intent.id }
    },
  })

  revalidatePath('/admin/provider-credit-payments')
  revalidatePath(`/admin/provider-credit-payments/${input.paymentIntentId}`)
  return result
}

export async function reconcileTopUpIntentFormAction(formData: FormData) {
  const paymentIntentId = String(formData.get('paymentIntentId') ?? '')
  try {
    await reconcileTopUpIntentAction({
      paymentIntentId,
      bankStatementReference: String(formData.get('bankStatementReference') ?? '').trim(),
      statementAmountCents: Math.round(Number(formData.get('statementAmountRand')) * 100),
      adminNote: String(formData.get('adminNote') ?? '').trim() || undefined,
    })
    redirect(adminCreditPaymentsPath(paymentIntentId, 'matched'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(adminCreditPaymentsPath(paymentIntentId, 'reconcile_failed'))
    }
    throw error
  }
}

export async function creditTopUpIntentFormAction(formData: FormData) {
  const paymentIntentId = String(formData.get('paymentIntentId') ?? '')
  try {
    await creditTopUpIntentAction({
      paymentIntentId,
      adminNote: String(formData.get('adminNote') ?? '').trim() || undefined,
    })
    redirect(adminCreditPaymentsPath(paymentIntentId, 'credited'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(adminCreditPaymentsPath(paymentIntentId, 'credit_failed'))
    }
    throw error
  }
}

export async function failTopUpIntentFormAction(formData: FormData) {
  const paymentIntentId = String(formData.get('paymentIntentId') ?? '')
  try {
    await failTopUpIntentAction({
      paymentIntentId,
      adminNote: String(formData.get('adminNote') ?? '').trim(),
    })
    redirect(adminCreditPaymentsPath(paymentIntentId, 'failed'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(adminCreditPaymentsPath(paymentIntentId, 'fail_failed'))
    }
    throw error
  }
}

export async function addTopUpIntentNoteFormAction(formData: FormData) {
  const paymentIntentId = String(formData.get('paymentIntentId') ?? '')
  try {
    await addTopUpIntentNoteAction({
      paymentIntentId,
      adminNote: String(formData.get('adminNote') ?? '').trim(),
    })
    redirect(adminCreditPaymentsPath(paymentIntentId, 'note_added'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(adminCreditPaymentsPath(paymentIntentId, 'note_failed'))
    }
    throw error
  }
}
