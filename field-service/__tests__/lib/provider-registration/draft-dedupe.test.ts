import { describe, expect, it } from 'vitest'
import { planDraftDedupe, type DedupeDraft } from '@/lib/provider-registration/draft-dedupe'

const d = (over: Partial<DedupeDraft>): DedupeDraft => ({
  id: 'x',
  phone: '+27820000000',
  updatedAt: new Date('2026-07-14T10:00:00Z'),
  lastCompletedStep: 2,
  submittedApplicationId: null,
  verifications: [],
  ...over,
})

describe('planDraftDedupe', () => {
  it('ignores phones with a single un-submitted draft', () => {
    expect(planDraftDedupe([d({ id: 'a' })])).toEqual([])
  })

  it('prefers the draft holding a non-terminal verification', () => {
    const plan = planDraftDedupe([
      d({ id: 'old', updatedAt: new Date('2026-07-14T09:00:00Z'), verifications: [{ id: 'v1', status: 'AWAITING_LIVENESS' }] }),
      d({ id: 'new', updatedAt: new Date('2026-07-14T11:00:00Z') }),
    ])
    expect(plan).toEqual([
      { phone: '+27820000000', winnerId: 'old', loserIds: ['new'], expireVerificationIds: [] },
    ])
  })

  it('falls back to newest updatedAt and expires loser verifications', () => {
    const plan = planDraftDedupe([
      d({ id: 'a', updatedAt: new Date('2026-07-14T09:00:00Z'), verifications: [{ id: 'v1', status: 'FAILED' }] }),
      d({ id: 'b', updatedAt: new Date('2026-07-14T11:00:00Z'), verifications: [{ id: 'v2', status: 'FAILED' }] }),
    ])
    // both verifications terminal → newest wins; terminal verifications are NOT expired, only detached losers'
    expect(plan[0].winnerId).toBe('b')
    expect(plan[0].loserIds).toEqual(['a'])
    expect(plan[0].expireVerificationIds).toEqual([]) // FAILED is already terminal
  })

  it('expires non-terminal verifications on losers when the winner also has one (newest non-terminal wins)', () => {
    const plan = planDraftDedupe([
      d({ id: 'a', updatedAt: new Date('2026-07-14T09:00:00Z'), verifications: [{ id: 'v1', status: 'AWAITING_LIVENESS' }] }),
      d({ id: 'b', updatedAt: new Date('2026-07-14T11:00:00Z'), verifications: [{ id: 'v2', status: 'AWAITING_LIVENESS' }] }),
    ])
    expect(plan[0].winnerId).toBe('b')
    expect(plan[0].expireVerificationIds).toEqual(['v1'])
  })

  it('never selects phones whose duplicates include a submitted draft (submitted rows are excluded upstream)', () => {
    // planDraftDedupe receives only un-submitted drafts; a submittedApplicationId row passed in is a programming error
    expect(() => planDraftDedupe([d({ id: 'a', submittedApplicationId: 'app' }), d({ id: 'b' })])).toThrow()
  })
})
