// ─── No-Match Diagnostics ─────────────────────────────────────────────────────
// Translates raw candidate/filter counts into a single request-level reason code.
// This is what ops sees on the dispatch_decisions row when a match fails — the
// per-provider filterSummary is for engineers; the noMatchReason is for humans.
//
// The classifier is intentionally cheap: at most one extra DB query (a bounded
// COUNT) is issued, and only when the candidate pool returned zero rows.

import { countProvidersInLocation } from './candidate-pool'
import type { FilteredProvider } from './orchestrator'

export type NoMatchReason =
  | 'INSUFFICIENT_REQUEST_DATA'
  | 'NO_LOCATION_MATCH'
  | 'NO_SKILL_MATCH_IN_LOCATION'
  | 'NO_APPROVED_PROVIDER'
  | 'NO_MATCH'

export type StageCounts = {
  // Providers serving the requested location, regardless of skill. Populated
  // lazily — only when we need to distinguish NO_LOCATION from NO_SKILL.
  locationCandidates: number | null
  // Providers from the candidate pool / direct scan (location + skill narrowed).
  skillCandidates: number
  // Of the skill-narrowed set, those that passed all hard filters.
  eligibleCount: number
  // Top-N actually ranked and offered.
  rankedCount: number
}

// Filter codes that point at provider status/approval/capacity rather than
// genuine skill/location mismatch. If every filtered-out provider hit one of
// these, the request didn't lack matching providers — it lacked AVAILABLE/
// APPROVED matching providers. List is kept in sync with the codes pushed by
// filter.ts and the declined-leads hard exclusion in orchestrator.ts.
const STATUS_REASON_CODES = new Set<string>([
  // Availability / liveness
  'TECHNICIAN_INACTIVE',
  'TECHNICIAN_NOT_AVAILABLE_NOW',
  'TECHNICIAN_OFFLINE',
  'TECHNICIAN_OFFLINE_LIVE',
  'TECHNICIAN_PAUSED',
  'TECHNICIAN_TEMP_PAUSED',
  'TECHNICIAN_HEARTBEAT_STALE',
  // Provider opt-outs for specific request flavours
  'SAME_DAY_NOT_AVAILABLE',
  'EMERGENCY_NOT_AVAILABLE',
  // Capacity / cooldown / prior action against THIS job
  'DAILY_MAX_REACHED',
  'OFFER_COOLDOWN_ACTIVE',
  'PROVIDER_PREVIOUSLY_DECLINED',
  // Approval
  'CATEGORY_NOT_APPROVED',
  // Request-level config mismatch (test cohort), not a true skill/location miss
  'TEST_COHORT_MISMATCH',
])

export type DiagnoseParams = {
  // Whether the request had a usable category slug + address. Caller decides
  // what counts as "usable" (see orchestrator.ts guards).
  hasUsableInputs: boolean
  // Counts from the funnel.
  skillCandidates: number
  eligibleCount: number
  rankedCount: number
  // Per-provider filter reasons, used to classify the eligibleCount=0 case.
  filteredOut: FilteredProvider[]
  // Address used for the bounded location-only count when skillCandidates=0.
  // Shape mirrors LoadCandidatePoolParams['address'] so it can be forwarded
  // straight into countProvidersInLocation without remapping.
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
}

export async function diagnoseNoMatchReason(
  params: DiagnoseParams,
): Promise<DiagnoseResult> {
  const { hasUsableInputs, skillCandidates, eligibleCount, rankedCount, filteredOut } = params

  // ── 1. Insufficient inputs short-circuit ────────────────────────────────────
  // Upstream already guards on no-address/no-category, but we double-check so
  // the diagnostic code is the source of truth for the reason string.
  if (!hasUsableInputs) {
    return {
      reason: 'INSUFFICIENT_REQUEST_DATA',
      stageCounts: {
        locationCandidates: null,
        skillCandidates: 0,
        eligibleCount: 0,
        rankedCount: 0,
      },
    }
  }

  // ── 2. Skill-narrowed pool empty → distinguish location vs skill miss ──────
  // Run ONE bounded count query against providers in the area. This is the
  // only place we issue extra DB load on the no-match path.
  if (skillCandidates === 0) {
    const locationCandidates = params.address
      ? await countProvidersInLocation({
          address: params.address,
          isTestRequest: params.isTestRequest,
        })
      : 0

    return {
      reason: locationCandidates === 0 ? 'NO_LOCATION_MATCH' : 'NO_SKILL_MATCH_IN_LOCATION',
      stageCounts: {
        locationCandidates,
        skillCandidates: 0,
        eligibleCount: 0,
        rankedCount: 0,
      },
    }
  }

  // ── 3. Candidates existed but none were eligible ───────────────────────────
  // If every filtered-out provider failed for a status/approval reason, the
  // matching pool was structurally fine — the providers just weren't ready.
  // Otherwise it's a generic NO_MATCH (mixed reasons: schedule, cert, equip).
  if (eligibleCount === 0) {
    const allStatusReasons = filteredOut.length > 0 && filteredOut.every((entry) =>
      entry.filteredReasonCodes.every((code) => STATUS_REASON_CODES.has(code)),
    )

    return {
      reason: allStatusReasons ? 'NO_APPROVED_PROVIDER' : 'NO_MATCH',
      stageCounts: {
        // We did not run the location-only count on this branch (we already
        // have skill candidates, so the question is moot). Leave null so ops
        // dashboards don't misread skillCandidates as a location-only number.
        locationCandidates: null,
        skillCandidates,
        eligibleCount: 0,
        rankedCount: 0,
      },
    }
  }

  // ── 4. Eligible providers existed; this path is for reservation-failure use
  // by the orchestrator (e.g. all top-ranked candidates were locked). Treated
  // as generic NO_MATCH at the request level — per-provider reservation reasons
  // live in rankingSummary.
  return {
    reason: 'NO_MATCH',
    stageCounts: {
      locationCandidates: null,
      skillCandidates,
      eligibleCount,
      rankedCount,
    },
  }
}
