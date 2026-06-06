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
import { expireOpenJobRequest } from '@/lib/job-requests/expire-job-request'
import { notifyExpiredJobParties } from './customer-recontact'
import { loadMatchingJobRequest } from './service'
import { loadCandidatePool } from './candidate-pool'
import { filterEligibleProviders, type FilteredCandidate } from './filter'
import { scoreAndRankCandidates } from './scoring'
import { reserveBestProviderAtomically } from './reservation'
import { dispatchMatchLead } from './dispatch'
import { emitMatchEvent } from './events'
import { sendCustomerMatchFoundNotification } from '@/lib/whatsapp'
import { notifyCustomerMatchingInProgress } from '@/lib/client-pwa-submission-notifications'
import { isEnabled } from '@/lib/flags'
import { findAlternativeSlots } from './alternative-slots'
import { MATCHING_CONFIG } from './config'
import {
  classifyNoMatch,
  diagnoseNoMatchReason,
  type FailureClass,
  type NoMatchReason,
  type StageCounts,
} from './diagnostics'
import type { SlotOption } from './types'

export type MatchOrchestrationResult =
  | { status: 'DISPATCHED'; holdId: string; providerId: string }
  | {
      status: 'NO_MATCH'
      filteredOut: FilteredProvider[]
      consideredCount: number
      // Aggregated reason for ops — see lib/matching/diagnostics.ts.
      noMatchReason: NoMatchReason
      stageCounts: StageCounts
      failureClass: FailureClass
      primaryReason: string
      evidence: string[]
    }
  | { status: 'ALT_SLOT_NEGOTIATION_SENT'; slotCount: number; strategy: string }
  | { status: 'SKIP'; reason: string; noMatchReason?: NoMatchReason }
  | { status: 'ERROR'; error: string }

export type MatchOrchestrationInitiator = {
  actorId: string
  actorRole: string
}

export type MatchCohortMode = 'AUTO' | 'LIVE_ONLY' | 'TEST_ONLY'

export type MatchOrchestrationOptions = {
  triggeredBy: 'job_creation' | 'cron' | 'manual' | 'rematch'
  cohortMode?: MatchCohortMode
  initiatedBy?: MatchOrchestrationInitiator
}

export type FilteredProvider = {
  providerId: string
  providerName?: string
  filteredReasonCodes: string[]
}

export async function orchestrateMatch(
  jobRequestId: string,
  options: MatchOrchestrationOptions
): Promise<MatchOrchestrationResult> {
  const start = Date.now()

  // ── Guard: only orchestrate OPEN jobs ──────────────────────────────────────
  const jobRequest = await loadMatchingJobRequest(db, jobRequestId).catch(() => null)

  if (!jobRequest) {
    return { status: 'SKIP', reason: 'JOB_NOT_FOUND' }
  }
  // Stage 1 of the funnel: insufficient request data.
  // A missing address or empty category means we cannot construct any
  // narrowing query — never query the full provider table in this state.
  if (!jobRequest.address) {
    emitSkippedNoMatch(jobRequestId, 'NO_ADDRESS', options.triggeredBy)
    return { status: 'SKIP', reason: 'NO_ADDRESS', noMatchReason: 'INSUFFICIENT_REQUEST_DATA' }
  }
  if (!jobRequest.category || !jobRequest.category.trim()) {
    emitSkippedNoMatch(jobRequestId, 'NO_CATEGORY', options.triggeredBy)
    return { status: 'SKIP', reason: 'NO_CATEGORY', noMatchReason: 'INSUFFICIENT_REQUEST_DATA' }
  }
  if (jobRequest.status !== 'OPEN') {
    return { status: 'SKIP', reason: `JOB_STATUS_${jobRequest.status}` }
  }
  if (jobRequest.assignmentMode !== 'AUTO_ASSIGN') {
    return { status: 'SKIP', reason: `JOB_MODE_${jobRequest.assignmentMode}` }
  }

  const resolvedCohortMode: MatchCohortMode = options.cohortMode ?? 'AUTO'
  const resolvedIsTestRequest = resolveCohortMode(
    resolvedCohortMode,
    jobRequest.isTestRequest,
  )
  const initiatedBy = options.initiatedBy ?? { actorId: 'system', actorRole: 'system' }
  const matchingJobRequest = {
    ...jobRequest,
    isTestRequest: resolvedIsTestRequest,
    cohortName: resolvedIsTestRequest ? jobRequest.cohortName : null,
  }
  const hadPriorDispatchDecision = Boolean(jobRequest.latestDispatchDecisionId)

  console.info('[orchestrator] match start', {
    jobRequestId,
    requestedCohortMode: resolvedCohortMode,
    isTestRequestForMatching: matchingJobRequest.isTestRequest,
    cohortNameForMatching: matchingJobRequest.cohortName,
    triggeredBy: options.triggeredBy,
    initiatedById: initiatedBy.actorId,
    initiatedByRole: initiatedBy.actorRole,
  })

  // Inline expiry guard: if the job has passed its expiresAt, transition it now
  // rather than dispatching. This covers the race between cron sweep ticks.
  if (jobRequest.expiresAt && jobRequest.expiresAt <= new Date()) {
    await expireOpenJobRequest(jobRequestId, 'expired_at_dispatch_time')
    return { status: 'SKIP', reason: 'JOB_EXPIRED' }
  }

  // ── Guard: skip if already actively held ──────────────────────────────────
  const existingHold = await db.assignmentHold.findFirst({
    where: { jobRequestId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: { id: true },
  })
  if (existingHold) {
    return { status: 'SKIP', reason: 'ALREADY_HELD' }
  }

  // ── Guard: skip if alternative-slot negotiation is in flight ──────────────
  // Once a customer/provider has been sent slot options, we pause auto-matching
  // until they respond (or 24h expire). The outcome field being null = still waiting.
  const negotiationCheck = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: { altSlotNegotiationSentAt: true, altSlotNegotiationOutcome: true },
  })
  if (
    negotiationCheck?.altSlotNegotiationSentAt != null &&
    negotiationCheck?.altSlotNegotiationOutcome == null
  ) {
    return { status: 'SKIP', reason: 'ALT_SLOT_NEGOTIATION_IN_FLIGHT' }
  }

  try {
    // 1. Fast candidate shortlist (precomputed pool or direct scan fallback)
    const useCandidatePool = await isEnabled('matching.v2.candidate_pool')
    const matchingAddress = matchingJobRequest.address
      ? {
          suburb: matchingJobRequest.address.suburb || null,
          city: matchingJobRequest.address.city || null,
          lat: matchingJobRequest.address.lat,
          lng: matchingJobRequest.address.lng,
          locationNodeId: matchingJobRequest.address.locationNodeId,
          provinceKey: matchingJobRequest.address.provinceKey,
        }
      : null

    if (!matchingAddress) {
      return { status: 'SKIP', reason: 'NO_ADDRESS' }
    }

    const rawCandidates = await loadCandidatePool({
      category: matchingJobRequest.category,
      address: matchingAddress,
      isTestRequest: matchingJobRequest.isTestRequest,
      limit: 30,
      usePool: useCandidatePool,
    })

    // Hard-exclude providers who already declined or ghosted (EXPIRED lead) for this job.
    // DECLINED = explicit rejection. EXPIRED = no response within the offer window (ghosted).
    // Ghosted providers are also auto-paused by pauseProviderAfterRepeatedOfferTimeouts,
    // but excluding their EXPIRED lead here ensures they are never immediately re-offered
    // on the same job even if the pause hasn't landed yet.
    const declinedLeads = await db.lead.findMany({
      where: { jobRequestId, status: { in: ['DECLINED', 'EXPIRED'] } },
      select: { providerId: true },
    })
    const declinedProviderIds = new Set(declinedLeads.map((l) => l.providerId))
    const declinedFilteredOut: FilteredProvider[] = rawCandidates
      .filter((c) => declinedProviderIds.has(c.id))
      .map((c) => ({ providerId: c.id, filteredReasonCodes: ['PROVIDER_PREVIOUSLY_DECLINED'] }))
    const candidatesForFiltering = declinedProviderIds.size > 0
      ? rawCandidates.filter((c) => !declinedProviderIds.has(c.id))
      : rawCandidates

    // 2. Filter: area coverage, skills, certs, equipment, live status, capacity
    const { eligible, filteredOut: eligibilityFilteredOut, nearMiss } = await filterEligibleProviders(
      candidatesForFiltering,
      matchingJobRequest as Parameters<typeof filterEligibleProviders>[1]
    )
    const filteredOut: FilteredProvider[] = [...declinedFilteredOut, ...eligibilityFilteredOut]

    if (eligible.length === 0) {
      // Stage 6 (funnel): classify the no-match reason so ops sees a single
      // request-level code rather than a list of per-provider filter codes.
      // diagnoseNoMatchReason may run ONE bounded COUNT query when the skill-
      // narrowed pool is 0 to distinguish "no providers in area" (NO_LOCATION_MATCH)
      // from "providers in area but not in this category" (NO_SKILL_MATCH_IN_LOCATION).
      const diagnosis = await diagnoseNoMatchReason({
        hasUsableInputs: true,
        skillCandidates: rawCandidates.length,
        eligibleCount: 0,
        rankedCount: 0,
        filteredOut,
        address: matchingAddress,
        isTestRequest: matchingJobRequest.isTestRequest,
        nearMissCount: nearMiss.length,
      })

      const noMatchExplanation = nearMiss.length > 0
        ? `No eligible providers for requested window - ${nearMiss.length} near-miss provider(s) found for alternative-slot negotiation`
        : `No eligible technicians passed the matching filters (${diagnosis.reason})`

      const decisionId = await recordDispatchDecision(db, {
        jobRequestId,
        mode: jobRequest.assignmentMode,
        status: 'NO_MATCH',
        consideredCount: rawCandidates.length,
        eligibleCount: 0,
        filteredOut,
        rankingSummary: [],
        explanation: noMatchExplanation,
        triggeredBy: options.triggeredBy,
        initiatedById: initiatedBy.actorId,
        initiatedByRole: initiatedBy.actorRole,
        noMatchReason: diagnosis.reason,
        stageCounts: diagnosis.stageCounts,
        failureClass: diagnosis.failureClass,
        primaryReason: diagnosis.primaryReason,
      })

      emitMatchEvent({
        event: 'match.no_providers',
        jobRequestId,
        category: jobRequest.category,
        suburb: jobRequest.address.suburb ?? undefined,
        consideredCount: rawCandidates.length,
        triggeredBy: options.triggeredBy,
        latencyMs: Date.now() - start,
        noMatchReason: diagnosis.reason,
        stageCounts: diagnosis.stageCounts,
      })

      // ── Phase 5: alternative-slot negotiation ────────────────────────────
      if (nearMiss.length > 0 && decisionId && options.triggeredBy !== 'rematch') {
        const altSlotResult = await tryAlternativeSlotNegotiation({
          jobRequest: matchingJobRequest,
          nearMiss,
          dispatchDecisionId: decisionId,
        })
        if (altSlotResult) return altSlotResult
      }

      if (
        !hadPriorDispatchDecision &&
        (diagnosis.failureClass === 'EMPTY_POOL' || diagnosis.failureClass === 'STRUCTURAL')
      ) {
        const expiry = await expireOpenJobRequest(jobRequestId, diagnosis.primaryReason)
        if (expiry?.transitioned) {
          await notifyExpiredJobParties({ jobRequestId })
        }
      }

      return {
        status: 'NO_MATCH',
        filteredOut,
        consideredCount: rawCandidates.length,
        noMatchReason: diagnosis.reason,
        stageCounts: diagnosis.stageCounts,
        failureClass: diagnosis.failureClass,
        primaryReason: diagnosis.primaryReason,
        evidence: diagnosis.evidence,
      }
    }

    // 3. Score and rank (pure - no DB calls)
    const ranked = scoreAndRankCandidates(eligible, matchingJobRequest)
    const initialRankedSummary = ranked.map((rc) => ({ ...rc }))

    const queuedRanked = ranked.slice(0, MATCHING_CONFIG.quickMatchMaxProviderOffers)
    const queueDecision = await persistQuickMatchQueueDecision(db, {
      jobRequestId,
      mode: jobRequest.assignmentMode,
      consideredCount: rawCandidates.length,
      eligibleCount: eligible.length,
      filteredOut,
      rankingSummary: initialRankedSummary,
      rankedCandidates: queuedRanked,
      triggeredBy: options.triggeredBy,
      initiatedById: initiatedBy.actorId,
      initiatedByRole: initiatedBy.actorRole,
    })

    // 4. Try top-10 candidates in rank order - stop on first successful reservation
    let reserved: Awaited<ReturnType<typeof reserveBestProviderAtomically>> | null = null
    const reservationFailures: Record<string, string> = {}

    for (const [queueIndex, rankedCandidate] of queuedRanked.entries()) {
      const candidate = eligible.find((e) => e.id === rankedCandidate.providerId)
      if (!candidate) continue
      const queuedAttempt = queueDecision.attemptsByProviderId.get(rankedCandidate.providerId)
      reserved = await reserveBestProviderAtomically({
        candidate,
        jobRequest: matchingJobRequest,
        dispatchDecisionId: queueDecision.id,
        matchAttemptId: queuedAttempt?.id,
        rankedPosition: queuedAttempt?.rankedPosition ?? queueIndex + 1,
      })
      if (reserved.ok) break
      reservationFailures[rankedCandidate.providerId] = reserved.reason
      if (queuedAttempt?.id) {
        await db.matchAttempt.update({
          where: { id: queuedAttempt.id },
          data: {
            stage: 'SKIPPED',
            reasonCode: reserved.reason,
          },
        }).catch((err) =>
          console.error('[orchestrator] failed to mark skipped queued attempt', {
            jobRequestId,
            providerId: rankedCandidate.providerId,
            matchAttemptId: queuedAttempt.id,
            err,
          })
        )
      }
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
          ? `Reservation failed - ${explanationParts.join(', ')}`
          : 'All top candidates were locked or at capacity'

      // All ranked candidates were locked/at capacity — eligible providers
      // existed, so this is NO_MATCH (generic), not NO_APPROVED_PROVIDER.
      // locationCandidates is null because we did not run the location-only
      // count on this path (we already have eligible candidates).
      const reservationStageCounts: StageCounts = {
        locationCandidates: null,
        skillCandidates: rawCandidates.length,
        eligibleCount: eligible.length,
        rankedCount: ranked.length,
      }
      const reservationClassification = classifyNoMatch({
        consideredCount: rawCandidates.length,
        eligibleCount: eligible.length,
        rankedCount: ranked.length,
        filteredOut,
        nearMissCount: 0,
        reservationFailureReasons: Object.values(reservationFailures),
        noMatchReason: 'NO_MATCH',
        stageCounts: reservationStageCounts,
      })
      await db.dispatchDecision.update({
        where: { id: queueDecision.id },
        data: {
          status: 'NO_MATCH',
          nextRetryAt: null,
          explanation,
          rankingSummary: annotatedRanked as object[],
          noMatchReason: 'NO_MATCH',
          stageCounts: reservationStageCounts as unknown as object,
          failureClass: reservationClassification.failureClass,
          primaryReason: reservationClassification.primaryReason,
        },
      }).catch((err) =>
        console.error('[orchestrator] failed to mark queued decision no-match', { jobRequestId, err })
      )
      return {
        status: 'NO_MATCH',
        filteredOut,
        consideredCount: rawCandidates.length,
        noMatchReason: 'NO_MATCH',
        stageCounts: reservationStageCounts,
        failureClass: reservationClassification.failureClass,
        primaryReason: reservationClassification.primaryReason,
        evidence: reservationClassification.evidence,
      }
    }
    // Note: nearMiss is not used here - reservation failures mean eligible providers exist
    // but are transiently locked. Cron will retry before escalating to slot negotiation.

    // 5. Dispatch lead (WhatsApp) - failure here does not roll back the hold
    await dispatchMatchLead({
      jobRequest: matchingJobRequest,
      hold: reserved.hold,
      provider: reserved.provider,
    })

    // 5a. Notify customer that matching is in progress (spec MSG2).
    // Fires once per request - idempotency is enforced by matchFoundWhatsappSentAt:
    // if CW2 was already sent we skip to avoid duplicate "checking" messages.
    // Failure is non-fatal and must not crash the orchestrator.
    await notifyCustomerMatchingInProgress({
      customerPhone: jobRequest.customer?.phone ?? null,
      category: matchingJobRequest.category,
      requestId: jobRequest.id,
      isAlreadySent: Boolean(jobRequest.matchFoundWhatsappSentAt),
    }).catch((err) =>
      console.error('[orchestrator] matching-in-progress notification failed (non-fatal)', {
        jobRequestId: jobRequest.id,
        err,
      })
    )

    // 5b. Notify customer that a provider has been matched (CW2)
    // Defensive: failure must not crash the orchestrator
    if (jobRequest.customer?.phone) {
      await sendCustomerMatchFoundNotification({
        customerPhone: jobRequest.customer.phone,
        providerName: reserved.provider.name,
        serviceName: matchingJobRequest.category,
        jobRequestId: jobRequest.id,
      }).catch((err) =>
        console.error('[orchestrator] customer match-found notification failed', {
          jobRequestId: jobRequest.id,
          err,
        })
      )
    }

    // 6. Audit trail: update the same decision that owns the top-10 queue.
    await db.dispatchDecision.update({
      where: { id: queueDecision.id },
      data: {
        status: 'OFFERING',
        selectedProviderId: reserved.provider.id,
        selectedMatchAttemptId: queueDecision.attemptsByProviderId.get(reserved.provider.id)?.id,
        consideredCount: rawCandidates.length,
        eligibleCount: eligible.length,
        filterSummary: filteredOut as object[],
        rankingSummary: annotatedRanked as object[],
        explanation: `Lead dispatched to ${reserved.provider.name}`,
        nextRetryAt: reserved.hold.expiresAt,
      },
    }).catch((err) =>
      console.error('[orchestrator] failed to update queued dispatch decision', { jobRequestId, err })
    )

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

// ── Alternative-slot negotiation helper ──────────────────────────────────────
async function tryAlternativeSlotNegotiation(params: {
  jobRequest: Awaited<ReturnType<typeof loadMatchingJobRequest>>
  nearMiss: import('./filter').NearMissProvider[]
  dispatchDecisionId: string
}): Promise<MatchOrchestrationResult | null> {
  const { jobRequest, nearMiss, dispatchDecisionId } = params
  const customerPhone = jobRequest.customer?.phone
  if (!customerPhone) return null

  const address = jobRequest.address
  if (!address) return null

  const slotOptions = findAlternativeSlots({
    nearMissProviders: nearMiss,
    jobRequest,
    requestAddress: address,
  })

  if (slotOptions.length === 0) return null

  // Persist slot options on the dispatch decision so the WA flow can look them up
  await db.dispatchDecision.update({
    where: { id: dispatchDecisionId },
    data: { alternativeSlotOptions: slotOptions as unknown as object[] },
  }).catch((err) =>
    console.error('[orchestrator] failed to save alternativeSlotOptions', { dispatchDecisionId, err })
  )

  // Choose strategy: provider-first for scarcity (single near-miss), customer-first otherwise
  const strategy = nearMiss.length === 1 ? 'provider_first' : 'customer_first'
  const primaryProvider = strategy === 'provider_first' ? nearMiss[0] : undefined

  try {
    const { initiateAlternativeSlotNegotiation } = await import('../whatsapp-flows/alternative-slot')
    await initiateAlternativeSlotNegotiation({
      jobRequestId: jobRequest.id,
      customerPhone,
      customerName: jobRequest.customer?.name ?? 'Customer',
      category: jobRequest.category,
      slotOptions,
      dispatchDecisionId,
      strategy,
      providerPhone: primaryProvider?.phone,
      providerName: primaryProvider?.name,
    })
  } catch (err) {
    console.error('[orchestrator] alt-slot negotiation dispatch failed', { jobRequestId: jobRequest.id, err })
    return null
  }

  return { status: 'ALT_SLOT_NEGOTIATION_SENT', slotCount: slotOptions.length, strategy }
}

async function persistQuickMatchQueueDecision(
  client: typeof db,
  params: {
    jobRequestId: string
    mode: string
    consideredCount: number
    eligibleCount: number
    filteredOut: FilteredProvider[]
    rankingSummary: unknown[]
    rankedCandidates: Array<{
      providerId: string
      score?: number
      rank?: number
      scoreBreakdown?: unknown
    }>
    triggeredBy: string
    initiatedById: string
    initiatedByRole: string
  },
): Promise<{
  id: string
  attemptsByProviderId: Map<string, { id: string; rankedPosition: number }>
}> {
  const idempotencyKey = JSON.stringify({
    jobRequestId: params.jobRequestId,
    status: 'RANKED',
    selectedProviderId: null,
    triggeredBy: params.triggeredBy,
    ts: Math.floor(Date.now() / 60_000),
  })

  // Wrap decision + jobRequest update + all attempt rows in one transaction so
  // a partial failure never leaves latestDispatchDecisionId pointing to an
  // incomplete queue (which would cause premature queue exhaustion).
  const { decisionId, attemptsByProviderId } = await client.$transaction(async (tx) => {
    const decision = await tx.dispatchDecision.create({
      data: {
        jobRequestId: params.jobRequestId,
        mode: params.mode as 'AUTO_ASSIGN' | 'OPS_REVIEW',
        status: 'RANKED',
        consideredCount: params.consideredCount,
        eligibleCount: params.eligibleCount,
        filterSummary: params.filteredOut as object[],
        rankingSummary: params.rankingSummary as object[],
        explanation: `Quick Match queue prepared for top ${params.rankedCandidates.length} provider(s)`,
        initiatedById: params.initiatedById,
        initiatedByRole: params.initiatedByRole,
        idempotencyKey,
      },
    })

    await tx.jobRequest.update({
      where: { id: params.jobRequestId },
      data: { latestDispatchDecisionId: decision.id },
    })

    const attemptsByProviderId = new Map<string, { id: string; rankedPosition: number }>()
    for (const [index, candidate] of params.rankedCandidates.entries()) {
      const rankedPosition = candidate.rank ?? index + 1
      const attempt = await tx.matchAttempt.create({
        data: {
          jobRequestId: params.jobRequestId,
          providerId: candidate.providerId,
          dispatchDecisionId: decision.id,
          attemptNumber: rankedPosition,
          rankedPosition,
          stage: 'RANKED',
          hardFilterPassed: true,
          filteredReasonCodes: [],
          feasibilityNotes: [],
          score: candidate.score,
          scoreBreakdown: candidate.scoreBreakdown as object | undefined,
        },
      })
      attemptsByProviderId.set(candidate.providerId, { id: attempt.id, rankedPosition })
    }

    return { decisionId: decision.id, attemptsByProviderId }
  })

  return { id: decisionId, attemptsByProviderId }
}

// ── Cohort resolution helper ───────────────────────────────────────────────
function resolveCohortMode(requestedMode: MatchCohortMode, requestIsTest: boolean): boolean {
  if (requestedMode === 'TEST_ONLY') return true
  if (requestedMode === 'LIVE_ONLY') return false
  return requestIsTest
}

// Emits a structured match.skipped event so ops sees insufficient-data
// outcomes alongside actual no-match outcomes. No DispatchDecision row is
// written: the request itself is malformed, not a failed matching attempt.
function emitSkippedNoMatch(jobRequestId: string, reason: string, triggeredBy: string): void {
  emitMatchEvent({ event: 'match.skipped', jobRequestId, reason, triggeredBy })
  console.warn('[orchestrator] match skipped - insufficient data', {
    jobRequestId,
    reason,
    triggeredBy,
  })
}

// ── Internal helper - writes DispatchDecision row ─────────────────────────────
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
    initiatedById: string
    initiatedByRole: string
    alternativeSlotOptions?: SlotOption[]
    noMatchReason?: NoMatchReason
    stageCounts?: StageCounts
    failureClass?: FailureClass
    primaryReason?: string
  }
): Promise<string | null> {
  // Idempotency key: prevents duplicate DispatchDecisions when orchestrateMatch()
  // is called concurrently from after(), cron and manual admin triggers.
  // Keyed on (jobRequestId, status, selectedProviderId, triggeredBy) - same inputs
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
        initiatedById: params.initiatedById,
        initiatedByRole: params.initiatedByRole,
        idempotencyKey,
        noMatchReason: params.noMatchReason ?? null,
        stageCounts: (params.stageCounts as unknown as object) ?? null,
        failureClass: params.failureClass ?? null,
        primaryReason: params.primaryReason ?? null,
      },
    })

    // Keep latestDispatchDecisionId on the job request in sync
    await client.jobRequest.update({
      where: { id: params.jobRequestId },
      data: { latestDispatchDecisionId: decision.id },
    })

    return decision.id
  } catch (err) {
    // Non-fatal - audit trail failure must not break the match
    console.error('[orchestrator] failed to record dispatch decision', { jobRequestId: params.jobRequestId, err })
    return null
  }
}
