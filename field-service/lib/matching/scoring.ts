// ─── Candidate Scoring ────────────────────────────────────────────────────────
// Pure scoring function - no DB calls.
// Takes the eligible provider set (already filtered and hydrated by filter.ts)
// and returns candidates sorted descending by score, then ascending by travel.
//
// Weights (config): skill 30%, schedule 20%, travel 20%, reliability 15%,
//                   customer preference 10%, margin 5%
// Region fallback penalty: -12%

import { MATCHING_CONFIG } from './config'
import { isLocationStale } from './geography'
import type { EligibleProvider } from './filter'
import type { MatchingJobRequest, RankedCandidate, ScoreBreakdown } from './types'

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase()
}

function getReliabilityScore(provider: EligibleProvider): number {
  if (provider.completedJobsCount === 0) {
    return provider.reliabilityScore || 0.5
  }
  return Math.min(
    1,
    Math.max(
      0,
      provider.reliabilityScore * 0.3 +
        provider.onTimeRate * 0.2 +
        provider.punctualityScore * 0.2 +
        (1 - provider.cancellationRate) * 0.1 +
        (1 - provider.complaintRate) * 0.1 +
        provider.acceptanceRate * 0.05 +
        Math.min(provider.averageRating / 5, 1) * 0.05
    )
  )
}

// TODO(preference-scoring): jobRequest.providerPreference now carries the MVP value
// (save_money | best_value | best_quality). When the matching dataset is reliable enough,
// apply weight shifts here before computing scores:
//   save_money   → boost marginEfficiency weight, moderate reliability boost
//   best_quality → boost reliability weight, allow higher-cost providers to rank up
//   best_value   → use default weights (current baseline)
// Keep minimum quality/trust thresholds regardless of preference; never rank untrusted
// providers highly just because they are cheap.
function buildScoreBreakdown(
  provider: EligibleProvider,
  jobRequest: MatchingJobRequest
): ScoreBreakdown {
  const weights = MATCHING_CONFIG.weights

  const requiredSkills = new Set(
    (jobRequest.requiredSkillTags.length > 0
      ? jobRequest.requiredSkillTags
      : [jobRequest.category]
    ).map(normalizeTag)
  )
  const providerSkills = new Set(
    [
      ...provider.skills,
      ...provider.technicianSkills.map((s) => s.skillTag),
    ].map(normalizeTag)
  )
  const skillMatch = [...requiredSkills].every((s) => providerSkills.has(s)) ? 1 : 0

  const scheduleFit = provider.scheduleFitScore
  const travelEfficiency = Math.max(
    0,
    1 - provider.travelMinutes / Math.max(provider.maxTravelMinutes, 1)
  )
  const reliability = getReliabilityScore(provider)
  const customerPreference = jobRequest.preferredProviderId === provider.id ? 1 : 0
  const marginEfficiency = Math.max(
    0,
    Math.min(
      1,
      (provider.maxTravelMinutes - provider.travelMinutes) / Math.max(provider.maxTravelMinutes, 1)
    )
  )
  const geographicPenalty =
    provider.coverageTier === 'REGION_FALLBACK' ? MATCHING_CONFIG.regionFallbackPenalty : 0

  const dailyJobs = provider.dailyAssignedJobs ?? 0
  // workloadFairness: 1.0 below preferred load, decays toward 0 above it
  const workloadFairness = dailyJobs < MATCHING_CONFIG.preferredDailyLoad
    ? 1
    : Math.max(0, 1 - (dailyJobs - MATCHING_CONFIG.preferredDailyLoad + 1) * 0.4)
  // Soft penalty applied to total when provider is at or above preferred load
  const workloadPenalty = workloadFairness < 1 ? 0.08 * (1 - workloadFairness) : 0

  const total =
    skillMatch * weights.skillMatch +
    scheduleFit * weights.scheduleFit +
    travelEfficiency * weights.travelEfficiency +
    reliability * weights.reliability +
    customerPreference * weights.customerPreference +
    marginEfficiency * weights.marginEfficiency -
    geographicPenalty -
    workloadPenalty

  const reasons: string[] = [
    skillMatch === 1 ? 'Required skills matched' : 'Missing required skill coverage',
    provider.canMeetWindow ? 'Can meet requested arrival window' : 'Window fit is weaker',
    `Estimated travel ${provider.travelMinutes} minutes`,
    `Reliability score ${reliability.toFixed(2)}`,
  ]

  if (!isLocationStale(provider.lastKnownLocationAt)) {
    reasons.push('Recent technician location available')
  }
  if (customerPreference > 0) {
    reasons.push('Preferred or repeat technician')
  }
  if (provider.coverageTier === 'REGION_FALLBACK') {
    reasons.push('Matched on region - provider may not cover this exact suburb')
  }
  if (provider.coverageTier === 'LEGACY_STRING') {
    reasons.push('Service area matched by name (legacy - structured areas not yet configured)')
  }
  if (dailyJobs >= MATCHING_CONFIG.preferredDailyLoad) {
    reasons.push(`Provider already has ${dailyJobs} job(s) today - fairness penalty applied`)
  }
  reasons.push(
    provider.verified ? 'Marketplace-reviewed profile' : 'Profile pending marketplace review'
  )

  return {
    skillMatch,
    scheduleFit,
    travelEfficiency,
    reliability,
    customerPreference,
    marginEfficiency,
    geographicPenalty,
    workloadFairness,
    total,
    reasons,
  }
}

export function scoreAndRankCandidates(
  eligible: EligibleProvider[],
  jobRequest: MatchingJobRequest
): RankedCandidate[] {
  const candidates: RankedCandidate[] = eligible.map((provider) => {
    const scoreBreakdown = buildScoreBreakdown(provider, jobRequest)
    return {
      providerId: provider.id,
      providerName: provider.name,
      score: scoreBreakdown.total,
      scoreBreakdown,
      filteredReasonCodes: [],
      feasibilityNotes: provider.feasibilityNotes,
      travelMinutes: provider.travelMinutes,
      availabilityState: provider.availabilityState,
      canMeetWindow: provider.canMeetWindow,
      estimatedStartAt: provider.estimatedStartAt,
      estimatedEndAt: provider.estimatedEndAt,
      reliabilityIndicators: {
        reliabilityScore: provider.reliabilityScore,
        averageRating: provider.averageRating,
        completedJobsCount: provider.completedJobsCount,
        onTimeRate: provider.onTimeRate,
        acceptanceRate: provider.acceptanceRate,
        complaintRate: provider.complaintRate,
        cancellationRate: provider.cancellationRate,
        punctualityScore: provider.punctualityScore,
      },
      selectionReason: scoreBreakdown.reasons[0] ?? 'Best overall operational fit',
    }
  })

  return candidates.sort((a, b) => b.score - a.score || a.travelMinutes - b.travelMinutes)
}
