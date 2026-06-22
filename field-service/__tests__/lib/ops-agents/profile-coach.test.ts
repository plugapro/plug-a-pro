import { describe, it, expect } from 'vitest'
import {
  COMPLETENESS_ITEMS,
  scoreProfile,
  isStrongProfile,
  evaluateProfile,
  extractProfileScores,
  type ProfileCandidate,
} from '../../../lib/ops-agents/agents/profile-coach/evaluator'

const ctx = { nowIso: '2026-06-21T09:00:00.000Z' }

function candidate(overrides: Partial<ProfileCandidate> = {}): ProfileCandidate {
  return {
    id: 'prov_1',
    phone: '+27600000000',
    firstName: 'Lebo',
    hasBio: true,
    hasAvatar: true,
    skillsCount: 2,
    serviceAreasCount: 2,
    hasExperience: true,
    portfolioCount: 3,
    equipmentCount: 1,
    verified: true,
    kycVerified: true,
    payoutVerified: true,
    averageRating: 4.6,
    completedJobsCount: 12,
    reliabilityScore: 0.9,
    acceptanceRate: 0.9,
    complaintRate: 0,
    whatsappMarketingOptIn: true,
    draftEligible: true,
    ...overrides,
  }
}

describe('profile-coach scoring', () => {
  it('completeness weights sum to 100', () => {
    expect(COMPLETENESS_ITEMS.reduce((s, i) => s + i.weight, 0)).toBe(100)
  })

  it('a full profile scores high on all three axes', () => {
    const s = scoreProfile(candidate())
    expect(s.completeness).toBe(100)
    expect(s.trust).toBe(100)
    expect(s.attractiveness).toBeGreaterThanOrEqual(90)
    expect(isStrongProfile(s)).toBe(true)
  })

  it('missing photo and bio lowers completeness by their weights', () => {
    const s = scoreProfile(candidate({ hasBio: false, hasAvatar: false }))
    expect(s.completeness).toBe(60) // 100 - 20 - 20
  })

  it('unverified / no-kyc tanks the trust score', () => {
    const s = scoreProfile(candidate({ verified: false, kycVerified: false }))
    expect(s.trust).toBe(45) // payout 15 + lowComplaints 15 + reliability 15
  })
})

describe('profile-coach evaluator output', () => {
  it('returns null for a strong profile (nothing to surface)', () => {
    expect(evaluateProfile(candidate(), ctx)).toBeNull()
  })

  it('surfaces a recommendation with scores in signals for a weak profile', () => {
    const e = evaluateProfile(
      candidate({ hasBio: false, hasAvatar: false, portfolioCount: 0, verified: false, kycVerified: false }),
      ctx,
    )!
    expect(e).not.toBeNull()
    expect(e.agentKey).toBe('PROVIDER_PROFILE_COACH')
    expect(e.entityType).toBe('PROVIDER')
    const scores = extractProfileScores(e.signals)
    expect(scores.completeness).toBeLessThan(85)
    expect(scores.trust).toBeGreaterThanOrEqual(0)
    expect(scores.attractiveness).toBeGreaterThanOrEqual(0)
  })

  it('drafts a coaching nudge for an opted-in, reachable provider with gaps', () => {
    const e = evaluateProfile(
      candidate({ hasBio: false, hasAvatar: false, portfolioCount: 0 }),
      ctx,
    )!
    expect(e.draft).toBeDefined()
    expect(e.draft!.recipientRole).toBe('PROVIDER')
    expect(e.draft!.template).toBe('FREEFORM')
  })

  it('does not draft when the provider has opted out of marketing', () => {
    const e = evaluateProfile(
      candidate({ hasBio: false, hasAvatar: false, portfolioCount: 0, whatsappMarketingOptIn: false }),
      ctx,
    )!
    expect(e.draft).toBeUndefined()
  })

  it('does not draft when the loader left this provider outside the per-run draft budget', () => {
    const e = evaluateProfile(
      candidate({ hasBio: false, hasAvatar: false, portfolioCount: 0, draftEligible: false }),
      ctx,
    )!
    // still surfaced as a recommendation, just no WhatsApp draft
    expect(e).not.toBeNull()
    expect(e.draft).toBeUndefined()
  })
})
