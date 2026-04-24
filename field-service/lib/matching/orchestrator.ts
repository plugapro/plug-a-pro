// ─── Matching Orchestrator ────────────────────────────────────────────────────
// Top-level entry point for all match attempts.
// Called synchronously on job creation (fire-and-forget) and by the cron (retry).
//
// Flow:
//   1. Load candidate pool (precomputed, falls back to direct scan)
//   2. Filter eligible providers (area, skills, certs, live status)
//   3. Score and rank the eligible set
//   4. Reserve best available provider atomically (SELECT FOR UPDATE SKIP LOCKED)
//   5. Dispatch WhatsApp lead
//   6. Record DispatchDecision audit trail

import { db } from '@/lib/db'
import { loadMatchingJobRequest } from './service'
import { loadCandidatePool } from './candidate-pool'
import { filterEligibleProviders, type FilteredCandidate } from './filter'
import { scoreAndRankCandidates } from './scoring'
import { reserveBestProviderAtomically } from './reservation'
import { dispatchMatchLead } from './dispatch'
import { emitMatchEvent } from './events'
import { isEnabled } from '@/lib/flags'

export type MatchOrchestrationResult =
  | { status: 'DISPATCHED'; holdId: string; providerId: string }
  | { status: 'NO_MATCH'; filteredOut: FilteredProvider[]; consideredCount: number }
  | { status: 'SKIP'; reason: string }
  | { status: 'ERROR'; error: string }

export type FilteredProvider = {
  providerId: string
  providerName?: string
  filteredReasonCodes: string[]
}

export async function orchestrateMatch(
  jobRequestId: string,
  options: { triggeredBy: 'job_creation' | 'cron' | 'manual' | 'rematch' }
): Promise<MatchOrchestrationResult> {
  const start = Date.now()

  // ── Guard: only orchestrate OPEN jobs ──────────────────────────────────────
  const jobRequest = await loadMatchingJobRequest(db, jobRequestId).catch(() => null)

  if (!jobRequest) {
    return { status: 'SKIP', reason: 'JOB_NOT_FOUND' }
  }
  if (!jobRequest.address) {
    return { status: 'SKIP', reason: 'NO_ADDRESS' }
  }
  if (jobRequest.status !== 'OPEN') {
    return { status: 'SKIP', reason: `JOB_STATUS_${jobRequest.status}` }
  }

  // ── Guard: skip if already actively held ──────────────────────────────────
  const existingHold = await db.assignmentHold.findFirst({
    where: { jobRequestId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: { id: true },
  })
  if (existingHold) {
    return { status: 'SKIP', reason: 'ALREADY_HELD' }
  }

  try {
    // 1. Fast candidate shortlist (precomputed pool or direct scan fallback)
    const useCandidatePool = await isEnabled('matching.v2.candidate_pool')
    const rawCandidates = await loadCandidatePool({
      category: jobRequest.category,
      address: jobRequest.address,
      limit: 30,
      usePool: useCandidatePool,
    })

    // 2. Filter: area coverage, skills, certs, equipment, live status, capacity
    const { eligible, filteredOut } = await filterEligibleProviders(
      rawCandidates,
      jobRequest as Parameters<typeof filterEligibleProviders>[1]
    )

    if (eligible.length === 0) {
      await recordDispatchDecision(db, {
        jobRequestId,
        mode: jobRequest.assignmentMode,
        status: 'NO_MATCH',
        consideredCount: rawCandidates.length,
        eligibleCount: 0,
        filteredOut,
        rankingSummary: [],
        explanation: 'No eligible technicians passed the matching filters',
        triggeredBy: options.triggeredBy,
      })
      emitMatchEvent({
        event: 'match.no_providers',
        jobRequestId,
        category: jobRequest.category,
        suburb: jobRequest.address.suburb ?? undefined,
        consideredCount: rawCandidates.length,
        triggeredBy: options.triggeredBy,
        latencyMs: Date.now() - start,
      })
      return { status: 'NO_MATCH', filteredOut, consideredCount: rawCandidates.length }
    }

    // 3. Score and rank (pure — no DB calls)
    const ranked = scoreAndRankCandidates(eligible, jobRequest)

    // 4. Try top-5 candidates in rank order — stop on first successful reservation
    let reserved: Awaited<ReturnType<typeof reserveBestProviderAtomically>> | null = null
    const reservationFailures: Record<string, string> = {}

    for (const rankedCandidate of ranked.slice(0, 5)) {
      const candidate = eligible.find((e) => e.id === rankedCandidate.providerId)
      if (!candidate) continue
      reserved = await reserveBestProviderAtomically({ candidate, jobRequest })
      if (reserved.ok) break
      reservationFailures[rankedCandidate.providerId] = reserved.reason
      emitMatchEvent({
        event: 'reservation.failed',
        jobRequestId,
        providerId: candidate.id,
        reason: reserved.reason,
      })
    }

    // Annotate ranked summary with per-candidate reservation failure reasons
    const annotatedRanked = ranked.map((rc) => ({
      ...rc,
      ...(reservationFailures[rc.providerId]
        ? { reservationFailureReason: reservationFailures[rc.providerId] }
        : {}),
    }))

    if (!reserved?.ok) {
      // Build a precise explanation instead of a generic catch-all
      const reasonCounts: Record<string, number> = {}
      for (const reason of Object.values(reservationFailures)) {
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
      }
      const explanationParts = Object.entries(reasonCounts).map(
        ([reason, count]) => `${count}× ${reason}`
      )
      const explanation =
        explanationParts.length > 0
          ? `Reservation failed — ${explanationParts.join(', ')}`
          : 'All top candidates were locked or at capacity'

      await recordDispatchDecision(db, {
        jobRequestId,
        mode: jobRequest.assignmentMode,
        status: 'NO_MATCH',
        consideredCount: rawCandidates.length,
        eligibleCount: eligible.length,
        filteredOut,
        rankingSummary: annotatedRanked,
        explanation,
        triggeredBy: options.triggeredBy,
      })
      return { status: 'NO_MATCH', filteredOut, consideredCount: rawCandidates.length }
    }

    // 5. Dispatch lead (WhatsApp) — failure here does not roll back the hold
    await dispatchMatchLead({
      jobRequest,
      hold: reserved.hold,
      provider: reserved.provider,
    })

    // 6. Audit trail
    await recordDispatchDecision(db, {
      jobRequestId,
      mode: jobRequest.assignmentMode,
      status: 'OFFERING',
      selectedProviderId: reserved.provider.id,
      consideredCount: rawCandidates.length,
      eligibleCount: eligible.length,
      filteredOut,
      rankingSummary: annotatedRanked,
      explanation: `Lead dispatched to ${reserved.provider.name}`,
      triggeredBy: options.triggeredBy,
    })

    emitMatchEvent({
      event: 'match.dispatched',
      jobRequestId,
      providerId: reserved.provider.id,
      holdId: reserved.hold.id,
      triggeredBy: options.triggeredBy,
      latencyMs: Date.now() - start,
    })

    return { status: 'DISPATCHED', holdId: reserved.hold.id, providerId: reserved.provider.id }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[orchestrator] match failed', { jobRequestId, error, triggeredBy: options.triggeredBy })
    return { status: 'ERROR', error }
  }
}

// ── Internal helper — writes DispatchDecision row ─────────────────────────────
async function recordDispatchDecision(
  client: typeof db,
  params: {
    jobRequestId: string
    mode: string
    status: string
    selectedProviderId?: string
    consideredCount: number
    eligibleCount: number
    filteredOut: FilteredProvider[]
    rankingSummary: unknown[]
    explanation: string
    triggeredBy: string
  }
) {
  // Idempotency key: prevents duplicate DispatchDecisions when orchestrateMatch()
  // is called concurrently from after(), cron, and manual admin triggers.
  // Keyed on (jobRequestId, status, selectedProviderId, triggeredBy) — same inputs
  // produce the same key and hit the ux_dispatch_decisions_job_idempotency DB index.
  const idempotencyKey = JSON.stringify({
    jobRequestId: params.jobRequestId,
    status: params.status,
    selectedProviderId: params.selectedProviderId ?? null,
    triggeredBy: params.triggeredBy,
    ts: Math.floor(Date.now() / 60_000), // 1-minute window prevents false dedup on retries
  })

  try {
    const decision = await client.dispatchDecision.create({
      data: {
        jobRequestId: params.jobRequestId,
        mode: params.mode as 'AUTO_ASSIGN' | 'OPS_REVIEW',
        status: params.status as 'NO_MATCH' | 'OFFERING' | 'RANKED',
        selectedProviderId: params.selectedProviderId ?? null,
        consideredCount: params.consideredCount,
        eligibleCount: params.eligibleCount,
        filterSummary: params.filteredOut as object[],
        rankingSummary: params.rankingSummary as object[],
        explanation: params.explanation,
        initiatedById: 'system',
        initiatedByRole: 'system',
        idempotencyKey,
      },
    })

    // Keep latestDispatchDecisionId on the job request in sync
    await client.jobRequest.update({
      where: { id: params.jobRequestId },
      data: { latestDispatchDecisionId: decision.id },
    })
  } catch (err) {
    // Non-fatal — audit trail failure must not break the match
    console.error('[orchestrator] failed to record dispatch decision', { jobRequestId: params.jobRequestId, err })
  }
}
