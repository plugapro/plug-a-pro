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
import { loadMatchingJobRequest } from './service'
import { loadCandidatePool } from './candidate-pool'
import { filterEligibleProviders, type FilteredCandidate } from './filter'
import { scoreAndRankCandidates } from './scoring'
import { reserveBestProviderAtomically } from './reservation'
import { dispatchMatchLead } from './dispatch'
import { emitMatchEvent } from './events'
import { sendCustomerMatchFoundNotification } from '@/lib/whatsapp'
import { isEnabled } from '@/lib/flags'
import { findAlternativeSlots } from './alternative-slots'
import type { SlotOption } from './types'

export type MatchOrchestrationResult =
  | { status: 'DISPATCHED'; holdId: string; providerId: string }
  | { status: 'NO_MATCH'; filteredOut: FilteredProvider[]; consideredCount: number }
  | { status: 'ALT_SLOT_NEGOTIATION_SENT'; slotCount: number; strategy: string }
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
    const rawCandidates = await loadCandidatePool({
      category: jobRequest.category,
      address: jobRequest.address,
      isTestRequest: jobRequest.isTestRequest,
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
      jobRequest as Parameters<typeof filterEligibleProviders>[1]
    )
    const filteredOut: FilteredProvider[] = [...declinedFilteredOut, ...eligibilityFilteredOut]

    if (eligible.length === 0) {
      const noMatchExplanation = nearMiss.length > 0
        ? `No eligible providers for requested window — ${nearMiss.length} near-miss provider(s) found for alternative-slot negotiation`
        : 'No eligible technicians passed the matching filters'

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

      // ── Phase 5: alternative-slot negotiation ────────────────────────────
      if (nearMiss.length > 0 && decisionId && options.triggeredBy !== 'rematch') {
        const altSlotResult = await tryAlternativeSlotNegotiation({
          jobRequest,
          nearMiss,
          dispatchDecisionId: decisionId,
        })
        if (altSlotResult) return altSlotResult
      }

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
    // Note: nearMiss is not used here — reservation failures mean eligible providers exist
    // but are transiently locked. Cron will retry before escalating to slot negotiation.

    // 5. Dispatch lead (WhatsApp) — failure here does not roll back the hold
    await dispatchMatchLead({
      jobRequest,
      hold: reserved.hold,
      provider: reserved.provider,
    })

    // 5b. Notify customer that a provider has been matched (CW2)
    // Defensive: failure must not crash the orchestrator
    await sendCustomerMatchFoundNotification({
      customerPhone: jobRequest.customer?.phone ?? '',
      providerName: reserved.provider.name,
      serviceName: jobRequest.category,
      jobRequestId: jobRequest.id,
    }).catch((err) =>
      console.error('[orchestrator] customer match-found notification failed', {
        jobRequestId: jobRequest.id,
        err,
      })
    )

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
    alternativeSlotOptions?: SlotOption[]
  }
): Promise<string | null> {
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

    return decision.id
  } catch (err) {
    // Non-fatal — audit trail failure must not break the match
    console.error('[orchestrator] failed to record dispatch decision', { jobRequestId: params.jobRequestId, err })
    return null
  }
}
