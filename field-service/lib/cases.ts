// ─── Case lifecycle service ───────────────────────────────────────────────────
// All state-mutating operations on Case records.
// Called from API route handlers and server actions - never inline in routes.

import { db } from '@/lib/db'
import { slaFor } from '@/lib/sla'
import { noteRequiredForCode } from '@/lib/reason-codes'
import type { OpsQueueType, CaseEntityType, CaseState } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateCaseParams {
  queueType:  OpsQueueType
  entityType: CaseEntityType
  entityId:   string
  createdAt?: Date
}

export interface ResolveParams {
  caseId:     string
  resolvedBy: string
  reasonCode: string
  outcome?:   string
  note?:      string
}

export interface ClaimParams {
  caseId: string
  userId: string
}

export interface AddNoteParams {
  caseId:       string
  authorUserId: string
  body:         string
}

export interface AddEventParams {
  caseId:      string
  type:        'STATE_CHANGE' | 'SYSTEM_EVENT' | 'OPS_ACTION' | 'NOTE_ADDED' |
               'ATTACHMENT_ADDED' | 'ASSIGNMENT_CHANGE' | 'CUSTOMER_CONTACTED' |
               'ESCALATION' | 'BREACH_DETECTED'
  payload?:    Record<string, unknown>
  actorUserId?: string
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getCase(caseId: string) {
  return db.case.findUnique({
    where: { id: caseId },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      notes:  { orderBy: { createdAt: 'asc' } },
    },
  })
}

export async function getCaseByEntity(
  queueType:  OpsQueueType,
  entityType: CaseEntityType,
  entityId:   string,
) {
  return db.case.findUnique({
    where: {
      entityType_entityId_queueType: { entityType, entityId, queueType },
    },
  })
}

// ─── Create ───────────────────────────────────────────────────────────────────

/** Creates a new Case or returns the existing one if it already exists. */
export async function openCase(params: CreateCaseParams) {
  const sla = slaFor(params.queueType)
  const base = params.createdAt ?? new Date()
  const slaDueAt = new Date(base.getTime() + sla.targetMinutes * 60_000)

  // Idempotent: return existing if already open
  const existing = await db.case.findUnique({
    where: {
      entityType_entityId_queueType: {
        entityType: params.entityType,
        entityId:   params.entityId,
        queueType:  params.queueType,
      },
    },
  })
  if (existing) return existing

  return db.case.create({
    data: {
      queueType:  params.queueType,
      entityType: params.entityType,
      entityId:   params.entityId,
      slaDueAt,
      events: {
        create: {
          type:    'SYSTEM_EVENT',
          payload: { event: 'case_opened' },
        },
      },
    },
  })
}

// ─── Assignment ───────────────────────────────────────────────────────────────

export async function claimCase(params: ClaimParams) {
  const c = await db.case.findUniqueOrThrow({ where: { id: params.caseId } })

  const updated = await db.case.update({
    where: { id: params.caseId },
    data:  {
      ownerUserId: params.userId,
      state:       c.state === 'OPEN' ? 'IN_PROGRESS' : c.state,
      events: {
        create: {
          type:        'ASSIGNMENT_CHANGE',
          payload:     { from: c.ownerUserId ?? null, to: params.userId },
          actorUserId: params.userId,
        },
      },
    },
  })
  return updated
}

export async function releaseCase(caseId: string, actorUserId: string) {
  return db.case.update({
    where: { id: caseId },
    data:  {
      ownerUserId: null,
      state:       'OPEN',
      events: {
        create: {
          type:        'ASSIGNMENT_CHANGE',
          payload:     { released: true },
          actorUserId,
        },
      },
    },
  })
}

export async function reassignCase(caseId: string, toUserId: string, actorUserId: string) {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } })

  return db.case.update({
    where: { id: caseId },
    data:  {
      ownerUserId: toUserId,
      events: {
        create: {
          type:        'ASSIGNMENT_CHANGE',
          payload:     { from: c.ownerUserId ?? null, to: toUserId },
          actorUserId,
        },
      },
    },
  })
}

// ─── Resolution ───────────────────────────────────────────────────────────────

export async function resolveCase(params: ResolveParams) {
  const RESOLVABLE: CaseState[] = ['OPEN', 'IN_PROGRESS', 'REOPENED']

  const c = await db.case.findUniqueOrThrow({ where: { id: params.caseId } })

  if (!RESOLVABLE.includes(c.state)) {
    throw new Error(`Case ${params.caseId} cannot be resolved from state "${c.state}"`)
  }

  if (noteRequiredForCode(c.queueType, params.reasonCode) && !params.note?.trim()) {
    throw new Error(`A note is required for reason code "${params.reasonCode}"`)
  }

  const now = new Date()

  return db.case.update({
    where: { id: params.caseId },
    data:  {
      state:      'RESOLVED',
      reasonCode: params.reasonCode,
      outcome:    params.outcome ?? null,
      resolvedAt: now,
      resolvedBy: params.resolvedBy,
      events: {
        create: {
          type:        'STATE_CHANGE',
          payload:     { from: 'IN_PROGRESS', to: 'RESOLVED', reasonCode: params.reasonCode },
          actorUserId: params.resolvedBy,
        },
      },
      notes: params.note?.trim()
        ? {
            create: {
              authorUserId: params.resolvedBy,
              body:         params.note.trim(),
            },
          }
        : undefined,
    },
  })
}

export async function reopenCase(caseId: string, actorUserId: string, reason?: string) {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } })
  const prevState: CaseState = c.state

  return db.case.update({
    where: { id: caseId },
    data:  {
      state:      'REOPENED',
      resolvedAt: null,
      resolvedBy: null,
      events: {
        create: {
          type:        'STATE_CHANGE',
          payload:     { from: prevState, to: 'REOPENED', reason: reason ?? null },
          actorUserId,
        },
      },
    },
  })
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function addNote(params: AddNoteParams) {
  const [note] = await db.$transaction([
    db.caseNote.create({
      data: {
        caseId:       params.caseId,
        authorUserId: params.authorUserId,
        body:         params.body,
      },
    }),
    db.case.update({
      where: { id: params.caseId },
      data:  {
        events: {
          create: {
            type:        'NOTE_ADDED',
            payload:     { preview: params.body.slice(0, 80) },
            actorUserId: params.authorUserId,
          },
        },
      },
    }),
  ])
  return note
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function addEvent(params: AddEventParams) {
  return db.caseEvent.create({
    data: {
      caseId:      params.caseId,
      type:        params.type,
      payload:     (params.payload ?? {}) as object,
      actorUserId: params.actorUserId ?? null,
    },
  })
}

// ─── Breach detection ────────────────────────────────────────────────────────

// ─── Breach queries ───────────────────────────────────────────────────────────

export interface BreachedCaseSummary {
  total: number
  byQueue: Array<{ queueType: OpsQueueType; count: number }>
  oldest: Array<{
    id: string
    queueType: OpsQueueType
    entityType: CaseEntityType
    entityId: string
    slaDueAt: Date
    ownerUserId: string | null
  }>
}

/** Returns all open/in-progress cases that have blown their SLA target. */
export async function getBreachedCases(): Promise<BreachedCaseSummary> {
  const now = new Date()
  const ACTIVE_STATES: CaseState[] = ['OPEN', 'IN_PROGRESS', 'REOPENED']

  const [raw, byQueueRaw] = await Promise.all([
    db.case.findMany({
      where: { slaDueAt: { lt: now }, state: { in: ACTIVE_STATES } },
      select: { id: true, queueType: true, entityType: true, entityId: true, slaDueAt: true, ownerUserId: true },
      orderBy: { slaDueAt: 'asc' },
      take: 20,
    }),
    db.case.groupBy({
      by: ['queueType'],
      where: { slaDueAt: { lt: now }, state: { in: ACTIVE_STATES } },
      _count: { _all: true },
    }),
  ])

  const total = byQueueRaw.reduce((s, r) => s + r._count._all, 0)
  const byQueue = byQueueRaw.map((r) => ({ queueType: r.queueType, count: r._count._all }))

  return { total, byQueue, oldest: raw }
}

/** Marks a case as breached and fires a BREACH_DETECTED event. Idempotent. */
export async function markBreach(caseId: string) {
  const c = await db.case.findUniqueOrThrow({
    where:  { id: caseId },
    select: { state: true, events: { where: { type: 'BREACH_DETECTED' }, take: 1 } },
  })
  if (c.events.length > 0) return // already marked

  return db.case.update({
    where: { id: caseId },
    data:  {
      events: {
        create: { type: 'BREACH_DETECTED', payload: { detectedAt: new Date().toISOString() } },
      },
    },
  })
}
