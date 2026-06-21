// ─── Matching Journey Monitor Agent (basic) — pure evaluator ─────────────────
// Flags submitted requests that are unmatched or stuck. Produces an admin alert,
// a recommended next action, and severity. No drafts. Pure: computes elapsed
// time from the injected `nowIso`, never the wall clock.
//
// See outputs/ops-agent-workflow-team/PlugAPro-Ops-Agent-Workflow-Team.md (Agent D).

import {
  buildDedupeKey,
  type Evaluation,
  type Evaluator,
  type RecommendedAction,
  type Signal,
} from '../../types'

const AGENT_KEY = 'MATCHING_JOURNEY_MONITOR' as const

export type MatchingFlag =
  | 'no_provider_available'
  | 'provider_response_overdue'
  | 'customer_response_overdue'
  | 'repeated_provider_declines'
  | 'request_outside_pilot_area'
  | 'job_not_progressing_after_match'

export interface MatchingCandidate {
  id: string
  status: string // JobRequestStatus
  createdAtIso: string
  updatedAtIso: string
  leadsCount: number
  pendingLeadsCount: number
  declineCount: number
  oldestPendingLeadIso: string | null
  hasMatch: boolean
  matchProgressed: boolean
  matchCreatedAtIso: string | null
  inPilotArea: boolean | null
}

// Thresholds (hours). Exported for tests.
export const NO_PROVIDER_HOURS = 4
export const PROVIDER_RESPONSE_HOURS = 6
export const CUSTOMER_RESPONSE_HOURS = 24
export const STUCK_AFTER_MATCH_HOURS = 48
export const REPEATED_DECLINES = 3

const AWAITING_CUSTOMER_STATUSES = new Set(['SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'])
const UNMATCHED_OPEN_STATUSES = new Set(['OPEN', 'MATCHING', 'PENDING_VALIDATION'])

function hoursBetween(fromIso: string, nowIso: string): number {
  return (new Date(nowIso).getTime() - new Date(fromIso).getTime()) / 3600_000
}

export interface MatchingFlagResult {
  flag: MatchingFlag
  severity: Evaluation['severity']
}

/** Most-severe-first detection. Returns null when nothing is wrong. */
export function detectMatchingFlag(
  c: MatchingCandidate,
  nowIso: string,
): MatchingFlagResult | null {
  // Stuck after a match is the most operationally urgent.
  if (
    c.hasMatch &&
    !c.matchProgressed &&
    c.matchCreatedAtIso &&
    hoursBetween(c.matchCreatedAtIso, nowIso) >= STUCK_AFTER_MATCH_HOURS
  ) {
    return { flag: 'job_not_progressing_after_match', severity: 'HIGH' }
  }

  if (!c.hasMatch && c.declineCount >= REPEATED_DECLINES) {
    return { flag: 'repeated_provider_declines', severity: 'HIGH' }
  }

  if (
    !c.hasMatch &&
    UNMATCHED_OPEN_STATUSES.has(c.status) &&
    c.leadsCount === 0 &&
    hoursBetween(c.createdAtIso, nowIso) >= NO_PROVIDER_HOURS
  ) {
    return { flag: 'no_provider_available', severity: 'HIGH' }
  }

  if (
    !c.hasMatch &&
    c.pendingLeadsCount > 0 &&
    c.oldestPendingLeadIso &&
    hoursBetween(c.oldestPendingLeadIso, nowIso) >= PROVIDER_RESPONSE_HOURS
  ) {
    return { flag: 'provider_response_overdue', severity: 'MEDIUM' }
  }

  if (
    AWAITING_CUSTOMER_STATUSES.has(c.status) &&
    hoursBetween(c.updatedAtIso, nowIso) >= CUSTOMER_RESPONSE_HOURS
  ) {
    return { flag: 'customer_response_overdue', severity: 'MEDIUM' }
  }

  if (c.inPilotArea === false) {
    return { flag: 'request_outside_pilot_area', severity: 'LOW' }
  }

  return null
}

const FLAG_LABEL: Record<MatchingFlag, string> = {
  no_provider_available: 'No provider available',
  provider_response_overdue: 'Provider response overdue',
  customer_response_overdue: 'Customer response overdue',
  repeated_provider_declines: 'Repeated provider declines',
  request_outside_pilot_area: 'Request outside pilot area',
  job_not_progressing_after_match: 'Job not progressing after match',
}

function actionsFor(flag: MatchingFlag): RecommendedAction[] {
  switch (flag) {
    case 'no_provider_available':
      return [{ code: 'manual_dispatch', label: 'Manually dispatch / widen search', href: '/admin/dispatch' }]
    case 'provider_response_overdue':
      return [{ code: 'nudge_providers', label: 'Nudge invited providers', href: '/admin/dispatch' }]
    case 'customer_response_overdue':
      return [{ code: 'nudge_customer', label: 'Follow up with the customer' }]
    case 'repeated_provider_declines':
      return [{ code: 'review_matching', label: 'Review matching criteria', href: '/admin/matches' }]
    case 'request_outside_pilot_area':
      return [{ code: 'waitlist_request', label: 'Add to out-of-area waitlist' }]
    case 'job_not_progressing_after_match':
      return [{ code: 'check_job', label: 'Check job progress with provider', href: '/admin/bookings' }]
  }
}

export const evaluateMatching: Evaluator<MatchingCandidate> = (c, ctx) => {
  const result = detectMatchingFlag(c, ctx.nowIso)
  if (!result) return null

  const { flag, severity } = result
  const signals: Signal[] = [
    { code: flag, label: FLAG_LABEL[flag], weight: 100 },
    { code: 'leads', label: 'Leads sent', weight: c.leadsCount },
    { code: 'declines', label: 'Provider declines', weight: c.declineCount },
  ]

  return {
    agentKey: AGENT_KEY,
    entityType: 'JOB_REQUEST',
    entityId: c.id,
    classification: flag,
    severity,
    signals,
    summary: `${FLAG_LABEL[flag]} — request needs ops attention.`,
    recommendedActions: actionsFor(flag),
    dedupeKey: buildDedupeKey(AGENT_KEY, c.id, `matching:${flag}`),
  }
}
