'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import type { CaseEventType, Prisma } from '@prisma/client'

const FLAG = 'ops.v2.cases'

const ResolveCaseSchema = z
  .object({
    caseId: z.string().min(1),
    outcome: z.string().min(1).max(500),
    reasonCode: z.string().min(1),
    note: z.string().max(2000),
  })
  .refine((d) => d.reasonCode !== 'OTHER' || d.note.trim().length > 0, {
    message: 'note is required when reasonCode is OTHER',
    path: ['note'],
  })

const ReopenCaseSchema = z.object({
  caseId: z.string().min(1),
  note: z.string().min(1).max(2000),
})

const AddCaseNoteSchema = z.object({
  caseId: z.string().min(1),
  body: z.string().min(1).max(2000),
})

// ─── helpers ─────────────────────────────────────────────────────────────────

type TxClient = Omit<
  typeof db,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

async function appendCaseEvent(
  tx: TxClient,
  caseId: string,
  type: CaseEventType,
  payload: Prisma.InputJsonValue,
  actorUserId?: string
) {
  await tx.caseEvent.create({
    data: { caseId, type, payload, actorUserId: actorUserId ?? null },
  })
}

function caseRevalidate() {
  revalidatePath('/admin/dispatch')
  revalidatePath('/admin/validation')
  revalidatePath('/admin/quotes')
  revalidatePath('/admin/field-exceptions')
  revalidatePath('/admin/payments')
  revalidatePath('/admin/bookings')
  revalidatePath('/admin/disputes')
}

// ─── claimCase ────────────────────────────────────────────────────────────────

export async function claimCaseAction(caseId: string) {
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  const result = await crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: caseId,
    action: 'case.claim',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    run: async (_input, tx) => {
      const existing = await tx.case.findUnique({
        where: { id: caseId },
        select: { id: true, state: true },
      })
      if (!existing) throw new CrudActionError('NOT_FOUND', `Case ${caseId} not found.`)
      await tx.case.update({
        where: { id: caseId },
        data: { ownerUserId: admin.id, state: 'IN_PROGRESS' },
      })
      await appendCaseEvent(tx, caseId, 'ASSIGNMENT_CHANGE', { claimedBy: admin.id }, admin.id)
      return { id: caseId }
    },
  })
  caseRevalidate()
  return result
}

// ─── releaseCase ──────────────────────────────────────────────────────────────

export async function releaseCaseAction(caseId: string) {
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  const result = await crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: caseId,
    action: 'case.release',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    run: async (_input, tx) => {
      await tx.case.update({
        where: { id: caseId },
        data: { ownerUserId: null, state: 'OPEN' },
      })
      await appendCaseEvent(tx, caseId, 'ASSIGNMENT_CHANGE', { releasedBy: admin.id }, admin.id)
      return { id: caseId }
    },
  })
  caseRevalidate()
  return result
}

// ─── resolveCase ──────────────────────────────────────────────────────────────

export async function resolveCaseAction(input: z.infer<typeof ResolveCaseSchema>) {
  const parsed = ResolveCaseSchema.parse(input)
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  const result = await crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: parsed.caseId,
    action: 'case.resolve',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    reason: `${parsed.reasonCode}: ${parsed.outcome}`,
    run: async (_input, tx) => {
      const now = new Date()
      await tx.case.update({
        where: { id: parsed.caseId },
        data: {
          state: 'RESOLVED',
          outcome: parsed.outcome,
          reasonCode: parsed.reasonCode,
          resolvedAt: now,
          resolvedBy: admin.id,
        },
      })
      await appendCaseEvent(
        tx,
        parsed.caseId,
        'STATE_CHANGE',
        { from: 'IN_PROGRESS', to: 'RESOLVED', outcome: parsed.outcome, reasonCode: parsed.reasonCode },
        admin.id
      )
      if (parsed.note.trim()) {
        await tx.caseNote.create({
          data: {
            caseId: parsed.caseId,
            authorUserId: admin.id,
            body: parsed.note,
            visibility: 'INTERNAL_ONLY',
          },
        })
        await appendCaseEvent(tx, parsed.caseId, 'NOTE_ADDED', { noteAuthor: admin.id }, admin.id)
      }
      return { id: parsed.caseId }
    },
  })
  caseRevalidate()
  return result
}

// ─── reopenCase ───────────────────────────────────────────────────────────────

export async function reopenCaseAction(input: z.infer<typeof ReopenCaseSchema>) {
  const parsed = ReopenCaseSchema.parse(input)
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  const result = await crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: parsed.caseId,
    action: 'case.reopen',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    reason: parsed.note,
    run: async (_input, tx) => {
      const existing = await tx.case.findUnique({
        where: { id: parsed.caseId },
        select: { resolvedAt: true },
      })
      if (!existing?.resolvedAt) {
        throw new CrudActionError('CONFLICT', 'Case is not resolved — cannot reopen.')
      }
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      if (existing.resolvedAt < thirtyDaysAgo) {
        throw new CrudActionError('CONFLICT', 'Case resolved more than 30 days ago — cannot reopen.')
      }
      await tx.case.update({
        where: { id: parsed.caseId },
        data: {
          state: 'REOPENED',
          resolvedAt: null,
          resolvedBy: null,
          outcome: null,
          reasonCode: null,
        },
      })
      await appendCaseEvent(
        tx,
        parsed.caseId,
        'STATE_CHANGE',
        { from: 'RESOLVED', to: 'REOPENED', note: parsed.note },
        admin.id
      )
      return { id: parsed.caseId }
    },
  })
  caseRevalidate()
  return result
}

// ─── addCaseNote ──────────────────────────────────────────────────────────────

export async function addCaseNoteAction(input: z.infer<typeof AddCaseNoteSchema>) {
  const parsed = AddCaseNoteSchema.parse(input)
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  const result = await crudAction({
    entity: AUDIT_ENTITY.CASE_NOTE,
    action: 'case.note.add',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    run: async (_input, tx) => {
      const note = await tx.caseNote.create({
        data: {
          caseId: parsed.caseId,
          authorUserId: admin.id,
          body: parsed.body,
          visibility: 'INTERNAL_ONLY',
        },
        select: { id: true },
      })
      await appendCaseEvent(tx, parsed.caseId, 'NOTE_ADDED', { noteId: note.id }, admin.id)
      return { id: note.id }
    },
  })
  caseRevalidate()
  return result
}
