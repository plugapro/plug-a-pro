// ─── Atomic Reservation ───────────────────────────────────────────────────────
// The concurrency boundary for the matching engine.
// Uses SELECT FOR UPDATE SKIP LOCKED to prevent two match attempts from
// reserving the same provider simultaneously.
//
// Rules:
//   - One call creates at most one AssignmentHold.
//   - If provider row is locked by another transaction → returns ok: false immediately.
//   - Capacity check (activeHolds < maxConcurrent) is inside the transaction.
//   - JobRequest status → MATCHING is set in the same transaction.

import { db } from '@/lib/db'
import { MATCHING_CONFIG } from './config'
import type { CandidatePoolEntry } from './candidate-pool'
import type { MatchingJobRequest } from './types'

type AssignmentHold = {
  id: string
  jobRequestId: string
  providerId: string
  status: string
  offeredAt: Date
  expiresAt: Date
}

type ReservationResult =
  | { ok: true; hold: AssignmentHold; provider: CandidatePoolEntry }
  | { ok: false; reason: 'PROVIDER_LOCKED' | 'ALREADY_HELD' | 'AT_CAPACITY' | 'TRANSACTION_FAILED' | 'JOB_NO_LONGER_OPEN' }

export async function reserveBestProviderAtomically(params: {
  candidate: CandidatePoolEntry
  jobRequest: MatchingJobRequest
}): Promise<ReservationResult> {
  const { candidate, jobRequest } = params
  const expiresAt = new Date(Date.now() + MATCHING_CONFIG.offerTtlMinutes * 60_000)

  try {
    const result = await db.$transaction(
      async (tx) => {
        // ── 1. Lock the provider row (SKIP LOCKED = fail fast, don't queue) ──
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM providers
          WHERE id = ${candidate.id}
            AND active = true
            AND verified = true
          FOR UPDATE SKIP LOCKED
        `
        if (locked.length === 0) {
          return { reason: 'PROVIDER_LOCKED' as const }
        }

        // ── 2. Re-check: no active hold created since filter step ─────────────
        const existingHold = await tx.assignmentHold.findFirst({
          where: {
            providerId: candidate.id,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        })
        if (existingHold) {
          return { reason: 'ALREADY_HELD' as const }
        }

        // ── 3. Capacity guard ─────────────────────────────────────────────────
        const capacity = await (tx as any).providerCapacity.findUnique({
          where: { providerId: candidate.id },
          select: { activeHolds: true, maxConcurrent: true },
        })
        if (capacity && capacity.activeHolds >= capacity.maxConcurrent) {
          return { reason: 'AT_CAPACITY' as const }
        }

        // ── 4. Re-check job is still OPEN ─────────────────────────────────────
        const job = await tx.jobRequest.findUnique({
          where: { id: jobRequest.id },
          select: { status: true },
        })
        if (job?.status !== 'OPEN') {
          return { reason: 'JOB_NO_LONGER_OPEN' as const }
        }

        // ── 5. Create stub DispatchDecision then MatchAttempt ─────────────────
        // DispatchDecision must come first — MatchAttempt requires its FK.
        // The orchestrator overwrites these with real data after the transaction.
        const dispatchDecision = await tx.dispatchDecision.create({
          data: {
            jobRequestId: jobRequest.id,
            mode: jobRequest.assignmentMode as 'AUTO_ASSIGN' | 'OPS_REVIEW',
            status: 'OFFERING',
            selectedProviderId: candidate.id,
            consideredCount: 1,
            eligibleCount: 1,
            filterSummary: [],
            rankingSummary: [],
            explanation: 'Reservation in progress',
            initiatedById: 'system',
            initiatedByRole: 'system',
          },
        })

        const matchAttempt = await tx.matchAttempt.create({
          data: {
            jobRequestId: jobRequest.id,
            providerId: candidate.id,
            dispatchDecisionId: dispatchDecision.id,
            attemptNumber: 1,
            rankedPosition: 1,
            stage: 'OFFERED',
            hardFilterPassed: true,
            score: candidate.scoreBase,
            offeredAt: new Date(),
          },
        })

        // ── 6. Create the AssignmentHold ───────────────────────────────────────
        const hold = await tx.assignmentHold.create({
          data: {
            jobRequestId: jobRequest.id,
            providerId: candidate.id,
            dispatchDecisionId: dispatchDecision.id,
            matchAttemptId: matchAttempt.id,
            status: 'ACTIVE',
            expiresAt,
          },
        })

        // ── 7. Update job status → MATCHING ───────────────────────────────────
        await tx.jobRequest.update({
          where: { id: jobRequest.id },
          data: { status: 'MATCHING', latestDispatchDecisionId: dispatchDecision.id },
        })

        // ── 8. Increment capacity counter ─────────────────────────────────────
        await (tx as any).providerCapacity.upsert({
          where: { providerId: candidate.id },
          create: { providerId: candidate.id, activeHolds: 1, activeJobs: 0, maxConcurrent: 2 },
          update: { activeHolds: { increment: 1 }, updatedAt: new Date() },
        })

        return { hold }
      },
      { timeout: 5_000, isolationLevel: 'ReadCommitted' }
    )

    if ('reason' in result) {
      return { ok: false, reason: result.reason! }
    }

    return { ok: true, hold: result.hold, provider: candidate }
  } catch (err) {
    console.error('[reservation] transaction failed', {
      providerId: candidate.id,
      jobRequestId: jobRequest.id,
      err,
    })
    return { ok: false, reason: 'TRANSACTION_FAILED' }
  }
}

// ── Decrement capacity counter — call when a hold resolves ─────────────────────

export async function releaseProviderCapacity(providerId: string): Promise<void> {
  await (db as any).providerCapacity.updateMany({
    where: { providerId, activeHolds: { gt: 0 } },
    data: { activeHolds: { decrement: 1 }, updatedAt: new Date() },
  })
}
