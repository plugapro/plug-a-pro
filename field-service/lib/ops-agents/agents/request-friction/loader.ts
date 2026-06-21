// ─── Service Request Friction Agent — loader + artifact persistence ──────────

import { type PrismaClient, type Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Evaluation } from '../../types'
import type { FrictionCandidate } from './evaluator'

const REASON_CODES = ['customer_cancelled', 'incomplete_submission'] as const

/** Stale unsubmitted requests older than this many hours count as incomplete/abandoned. */
const STALE_INCOMPLETE_HOURS = 2

export interface LoadArgs {
  nowIso: string
  windowFromIso?: string | null
  windowToIso?: string | null
}

export async function loadFrictionCandidates(args: LoadArgs): Promise<FrictionCandidate[]> {
  const now = new Date(args.nowIso)
  const staleBefore = new Date(now.getTime() - STALE_INCOMPLETE_HOURS * 3600_000)
  const windowFrom = args.windowFromIso ? new Date(args.windowFromIso) : undefined
  const windowTo = args.windowToIso ? new Date(args.windowToIso) : undefined
  const updatedAt =
    windowFrom || windowTo
      ? { ...(windowFrom ? { gte: windowFrom } : {}), ...(windowTo ? { lte: windowTo } : {}) }
      : undefined

  const requests = await db.jobRequest.findMany({
    where: {
      isTestRequest: false,
      ...(updatedAt ? { updatedAt } : {}),
      OR: [
        { status: 'CANCELLED' },
        { status: 'PENDING_VALIDATION', updatedAt: { lt: staleBefore } },
      ],
    },
    select: {
      id: true,
      status: true,
      category: true,
      addressId: true,
      customerAddressId: true,
      description: true,
      urgency: true,
      requestedArrivalLatest: true,
      requestedWindowStart: true,
      _count: { select: { attachments: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  return requests.map((r): FrictionCandidate => ({
    id: r.id,
    kind: r.status === 'CANCELLED' ? 'cancelled' : 'incomplete',
    hasCategory: Boolean(r.category && r.category.trim()),
    hasAddress: Boolean(r.addressId || r.customerAddressId),
    descriptionLength: (r.description ?? '').trim().length,
    photoCount: r._count.attachments,
    hasUrgency: Boolean(r.urgency || r.requestedArrivalLatest),
    hasSlot: Boolean(r.requestedWindowStart),
  }))
}

/**
 * Persist a RequestFrictionSignal row, idempotently: skip if an unresolved row
 * already exists for the same (jobRequestId, stage, reason) so re-runs don't
 * pile up duplicates. Stage and reason are read back from the Evaluation
 * (classification = `friction_<stage>`; reason carried as a signal code).
 */
export async function persistFrictionSignal(
  evaluation: Evaluation,
  client: PrismaClient | Prisma.TransactionClient = db,
): Promise<void> {
  const stage = evaluation.classification.replace(/^friction_/, '')
  const reasonCode =
    evaluation.signals.map((s) => s.code).find((c) => (REASON_CODES as readonly string[]).includes(c)) ??
    'unknown'

  const existing = await client.requestFrictionSignal.findFirst({
    where: { jobRequestId: evaluation.entityId, dropoffStage: stage, reasonCode, resolved: false },
    select: { id: true },
  })
  if (existing) return

  await client.requestFrictionSignal.create({
    data: {
      jobRequestId: evaluation.entityId,
      dropoffStage: stage,
      reasonCode,
      detail: `severity=${evaluation.severity}`,
    },
  })
}
