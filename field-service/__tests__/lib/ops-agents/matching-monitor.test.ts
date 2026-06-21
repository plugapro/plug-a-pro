import { describe, it, expect } from 'vitest'
import {
  detectMatchingFlag,
  evaluateMatching,
  type MatchingCandidate,
} from '../../../lib/ops-agents/agents/matching-monitor/evaluator'

const NOW = '2026-06-21T12:00:00.000Z'
const ctx = { nowIso: NOW }

function hoursAgo(h: number): string {
  return new Date(new Date(NOW).getTime() - h * 3600_000).toISOString()
}

function candidate(overrides: Partial<MatchingCandidate> = {}): MatchingCandidate {
  return {
    id: 'jr_1',
    status: 'OPEN',
    createdAtIso: hoursAgo(1),
    updatedAtIso: hoursAgo(1),
    leadsCount: 1,
    pendingLeadsCount: 0,
    declineCount: 0,
    oldestPendingLeadIso: null,
    hasMatch: false,
    matchProgressed: false,
    matchCreatedAtIso: null,
    inPilotArea: true,
    ...overrides,
  }
}

describe('matching-monitor flag detection', () => {
  it('returns null for a healthy, recent request', () => {
    expect(detectMatchingFlag(candidate(), NOW)).toBeNull()
  })

  it('flags no_provider_available when OPEN with 0 leads beyond threshold', () => {
    const r = detectMatchingFlag(candidate({ leadsCount: 0, createdAtIso: hoursAgo(5) }), NOW)
    expect(r?.flag).toBe('no_provider_available')
    expect(r?.severity).toBe('HIGH')
  })

  it('does not flag no_provider before the threshold', () => {
    expect(detectMatchingFlag(candidate({ leadsCount: 0, createdAtIso: hoursAgo(2) }), NOW)).toBeNull()
  })

  it('flags repeated_provider_declines at/over the threshold', () => {
    const r = detectMatchingFlag(candidate({ declineCount: 3, leadsCount: 3 }), NOW)
    expect(r?.flag).toBe('repeated_provider_declines')
  })

  it('flags provider_response_overdue when a lead has been pending too long', () => {
    const r = detectMatchingFlag(
      candidate({ leadsCount: 1, pendingLeadsCount: 1, oldestPendingLeadIso: hoursAgo(7) }),
      NOW,
    )
    expect(r?.flag).toBe('provider_response_overdue')
    expect(r?.severity).toBe('MEDIUM')
  })

  it('flags customer_response_overdue for a stale awaiting-customer request', () => {
    const r = detectMatchingFlag(
      candidate({ status: 'SHORTLIST_READY', leadsCount: 2, updatedAtIso: hoursAgo(25) }),
      NOW,
    )
    expect(r?.flag).toBe('customer_response_overdue')
  })

  it('flags job_not_progressing_after_match when a match is stuck', () => {
    const r = detectMatchingFlag(
      candidate({ status: 'MATCHED', hasMatch: true, matchProgressed: false, matchCreatedAtIso: hoursAgo(50) }),
      NOW,
    )
    expect(r?.flag).toBe('job_not_progressing_after_match')
    expect(r?.severity).toBe('HIGH')
  })

  it('does not flag a stuck match once it has progressed', () => {
    expect(
      detectMatchingFlag(
        candidate({ status: 'MATCHED', hasMatch: true, matchProgressed: true, matchCreatedAtIso: hoursAgo(50) }),
        NOW,
      ),
    ).toBeNull()
  })

  it('flags request_outside_pilot_area as LOW when explicitly out of area', () => {
    const r = detectMatchingFlag(candidate({ inPilotArea: false }), NOW)
    expect(r?.flag).toBe('request_outside_pilot_area')
    expect(r?.severity).toBe('LOW')
  })
})

describe('matching-monitor evaluator output', () => {
  it('builds an Evaluation with a flag-keyed dedupeKey when flagged', () => {
    const e = evaluateMatching(candidate({ leadsCount: 0, createdAtIso: hoursAgo(5) }), ctx)!
    expect(e.agentKey).toBe('MATCHING_JOURNEY_MONITOR')
    expect(e.classification).toBe('no_provider_available')
    expect(e.dedupeKey).toBe('MATCHING_JOURNEY_MONITOR:jr_1:matching:no_provider_available')
    expect(e.draft).toBeUndefined()
  })

  it('returns null (no recommendation) for a healthy request', () => {
    expect(evaluateMatching(candidate(), ctx)).toBeNull()
  })
})
