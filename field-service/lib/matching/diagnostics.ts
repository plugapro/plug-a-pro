// ─── No-Match Diagnostics ─────────────────────────────────────────────────────
// Translates raw candidate/filter counts into request-level diagnostics and a
// separate retry/give-up policy classification.

import { countProvidersInLocation } from './candidate-pool'
import type { FilteredProvider } from './orchestrator'

export type NoMatchReason =
  | 'INSUFFICIENT_REQUEST_DATA'
  | 'NO_LOCATION_MATCH'
  | 'NO_SKILL_MATCH_IN_LOCATION'
  | 'NO_APPROVED_PROVIDER'
  | 'NO_MATCH'

export type FailureClass = 'EMPTY_POOL' | 'STRUCTURAL' | 'TRANSIENT'

export type NoMatchClassification = {
  failureClass: FailureClass
  primaryReason: string
  evidence: string[]
}

export type StageCounts = {
  // Providers serving the requested location, regardless of skill. Populated
  // lazily only when skillCandidates is zero.
  locationCandidates: number | null
  // Providers from the candidate pool / direct scan (location + skill narrowed).
  skillCandidates: number
  // Of the skill-narrowed set, those that passed all hard filters.
  eligibleCount: number
  // Top-N actually ranked and offered.
  rankedCount: number
}

// Filter codes that point at provider status/approval/capacity rather than
// genuine skill/location mismatch. Kept for the existing ops diagnostic
// noMatchReason. The policy classifier below deliberately treats most of these
// as TRANSIENT instead of structural give-up signals.
const STATUS_REASON_CODES = new Set<string>([
  'TECHNICIAN_INACTIVE',
  'TECHNICIAN_NOT_AVAILABLE_NOW',
  'TECHNICIAN_OFFLINE',
  'TECHNICIAN_OFFLINE_LIVE',
  'TECHNICIAN_PAUSED',
  'TECHNICIAN_TEMP_PAUSED',
  'TECHNICIAN_HEARTBEAT_STALE',
  'SAME_DAY_NOT_AVAILABLE',
  'EMERGENCY_NOT_AVAILABLE',
  'DAILY_MAX_REACHED',
  'OFFER_COOLDOWN_ACTIVE',
  'PROVIDER_PREVIOUSLY_DECLINED',
  'CATEGORY_NOT_APPROVED',
  'TEST_COHORT_MISMATCH',
  // Candidate cleared the pool prefilter but failed the metrics query's KYC gate
  // (see lib/matching/filter.ts) — a status/approval reason, not skill/location.
  'KYC_NOT_VERIFIED',
])

const PERMANENT_REASON_FAMILIES = new Set<string>([
  'TEST_COHORT_MISMATCH',
  'KYC_NOT_VERIFIED',
  'OUTSIDE_SERVICE_AREA',
  'MISSING_REQUIRED_SKILL',
  'MISSING_REQUIRED_CERTIFICATION',
  'MISSING_REQUIRED_EQUIPMENT',
  'MISSING_REQUIRED_VEHICLE',
  'CATEGORY_NOT_APPROVED',
  'TECHNICIAN_INACTIVE',
])

export type DiagnoseParams = {
  hasUsableInputs: boolean
  skillCandidates: number
  eligibleCount: number
  rankedCount: number
  filteredOut: FilteredProvider[]
  nearMissCount?: number
  reservationFailureReasons?: string[]
  address: {
    suburb: string | null
    city: string | null
    lat: number | null
    lng: number | null
    locationNodeId?: string | null
    provinceKey?: string | null
  } | null
  isTestRequest: boolean
}

export type DiagnoseResult = {
  reason: NoMatchReason
  stageCounts: StageCounts
} & NoMatchClassification

export type ClassifyNoMatchParams = {
  consideredCount: number
  eligibleCount: number
  rankedCount: number
  filteredOut: FilteredProvider[]
  nearMissCount: number
  reservationFailureReasons: string[]
  noMatchReason: NoMatchReason | string | null
  stageCounts: StageCounts
}

function normalizeReasonFamily(code: string) {
  const trimmed = code.trim()
  if (trimmed.startsWith('MISSING_REQUIRED_CERTIFICATION:')) return 'MISSING_REQUIRED_CERTIFICATION'
  if (trimmed.startsWith('MISSING_REQUIRED_EQUIPMENT:')) return 'MISSING_REQUIRED_EQUIPMENT'
  return trimmed
}

function isPermanentReason(code: string) {
  return PERMANENT_REASON_FAMILIES.has(normalizeReasonFamily(code))
}

function chooseMajorityReason(filteredOut: FilteredProvider[], fallback: string) {
  const counts = new Map<string, number>()
  const firstSeen: string[] = []

  for (const provider of filteredOut) {
    for (const code of provider.filteredReasonCodes) {
      const family = normalizeReasonFamily(code)
      if (!family) continue
      if (!counts.has(family)) firstSeen.push(family)
      counts.set(family, (counts.get(family) ?? 0) + 1)
    }
  }

  let winner = fallback
  let winnerCount = -1
  for (const family of firstSeen) {
    const count = counts.get(family) ?? 0
    if (count > winnerCount) {
      winner = family
      winnerCount = count
    }
  }
  return winner
}

export function classifyNoMatch(params: ClassifyNoMatchParams): NoMatchClassification {
  const evidence = [
    `considered_count=${params.consideredCount}`,
    `eligible_count=${params.eligibleCount}`,
    `ranked_count=${params.rankedCount}`,
  ]

  if (params.consideredCount === 0) {
    const locationCandidates = params.stageCounts.locationCandidates ?? 0
    const primaryReason =
      params.noMatchReason === 'NO_SKILL_MATCH_IN_LOCATION' || locationCandidates > 0
        ? 'NO_SKILL_MATCH_IN_LOCATION'
        : 'NO_LOCATION_MATCH'

    return {
      failureClass: 'EMPTY_POOL',
      primaryReason,
      evidence: [
        ...evidence,
        `location_candidates=${locationCandidates}`,
      ],
    }
  }

  if (params.reservationFailureReasons.length > 0) {
    return {
      failureClass: 'TRANSIENT',
      primaryReason: 'RESERVATION_FAILED',
      evidence: [
        ...evidence,
        `reservation_failures=${params.reservationFailureReasons.length}`,
      ],
    }
  }

  if (params.nearMissCount > 0) {
    return {
      failureClass: 'TRANSIENT',
      primaryReason: chooseMajorityReason(params.filteredOut, 'SCHEDULE_CONFLICT'),
      evidence: [
        ...evidence,
        `near_miss_count=${params.nearMissCount}`,
      ],
    }
  }

  const permanentProviderCount = params.filteredOut.filter((provider) =>
    provider.filteredReasonCodes.some(isPermanentReason),
  ).length
  evidence.push(`permanent_filtered_providers=${permanentProviderCount}/${params.filteredOut.length}`)

  if (
    params.consideredCount > 0 &&
    params.filteredOut.length > 0 &&
    permanentProviderCount === params.filteredOut.length
  ) {
    return {
      failureClass: 'STRUCTURAL',
      primaryReason: chooseMajorityReason(params.filteredOut, params.noMatchReason ?? 'NO_MATCH'),
      evidence,
    }
  }

  return {
    failureClass: 'TRANSIENT',
    primaryReason: chooseMajorityReason(params.filteredOut, params.noMatchReason ?? 'NO_MATCH'),
    evidence,
  }
}

function withClassification(
  result: { reason: NoMatchReason; stageCounts: StageCounts },
  params: Omit<ClassifyNoMatchParams, 'noMatchReason' | 'stageCounts'>,
): DiagnoseResult {
  return {
    ...result,
    ...classifyNoMatch({
      ...params,
      noMatchReason: result.reason,
      stageCounts: result.stageCounts,
    }),
  }
}

export async function diagnoseNoMatchReason(
  params: DiagnoseParams,
): Promise<DiagnoseResult> {
  const { hasUsableInputs, skillCandidates, eligibleCount, rankedCount, filteredOut } = params
  const baseClassificationParams = {
    consideredCount: skillCandidates,
    eligibleCount,
    rankedCount,
    filteredOut,
    nearMissCount: params.nearMissCount ?? 0,
    reservationFailureReasons: params.reservationFailureReasons ?? [],
  }

  if (!hasUsableInputs) {
    return withClassification(
      {
        reason: 'INSUFFICIENT_REQUEST_DATA',
        stageCounts: {
          locationCandidates: null,
          skillCandidates: 0,
          eligibleCount: 0,
          rankedCount: 0,
        },
      },
      { ...baseClassificationParams, consideredCount: 0 },
    )
  }

  if (skillCandidates === 0) {
    const locationCandidates = params.address
      ? await countProvidersInLocation({
          address: params.address,
          isTestRequest: params.isTestRequest,
        })
      : 0

    return withClassification(
      {
        reason: locationCandidates === 0 ? 'NO_LOCATION_MATCH' : 'NO_SKILL_MATCH_IN_LOCATION',
        stageCounts: {
          locationCandidates,
          skillCandidates: 0,
          eligibleCount: 0,
          rankedCount: 0,
        },
      },
      { ...baseClassificationParams, consideredCount: 0 },
    )
  }

  if (eligibleCount === 0) {
    const allStatusReasons = filteredOut.length > 0 && filteredOut.every((entry) =>
      entry.filteredReasonCodes.every((code) => STATUS_REASON_CODES.has(code)),
    )

    return withClassification(
      {
        reason: allStatusReasons ? 'NO_APPROVED_PROVIDER' : 'NO_MATCH',
        stageCounts: {
          locationCandidates: null,
          skillCandidates,
          eligibleCount: 0,
          rankedCount: 0,
        },
      },
      baseClassificationParams,
    )
  }

  return withClassification(
    {
      reason: 'NO_MATCH',
      stageCounts: {
        locationCandidates: skillCandidates,
        skillCandidates,
        eligibleCount,
        rankedCount,
      },
    },
    baseClassificationParams,
  )
}
