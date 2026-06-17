import { describe, expect, it } from 'vitest'
import {
  computeProviderQuality,
  getHighRiskSkills,
  aggregateQualityCounts,
  isDimensionSatisfied,
  type ProviderQualityInput,
} from '../../lib/provider-quality/quality'
import {
  countRecentNudges,
  isRecentlyNudged,
  NUDGE_SPACING_DAYS,
  pickNudgeDimension,
  planNudgeForProvider,
} from '../../lib/provider-quality/nudge'

function makeInput(overrides: Partial<ProviderQualityInput> = {}): ProviderQualityInput {
  return {
    id: 'p1',
    name: 'Test Provider',
    firstName: 'Test',
    phone: '+27800000001',
    active: true,
    skills: ['handyman'],
    avatarUrl: 'https://blob.example/avatar.jpg',
    portfolioUrls: ['https://blob.example/p1.jpg'],
    kycStatus: 'VERIFIED',
    certifications: [],
    ...overrides,
  }
}

describe('getHighRiskSkills', () => {
  it('classifies plumbing and electrical as high-risk', () => {
    expect(getHighRiskSkills(['plumbing'])).toEqual(['plumbing'])
    expect(getHighRiskSkills(['electrical'])).toEqual(['electrical'])
  })

  it('treats handyman + garden as standard (not high-risk)', () => {
    expect(getHighRiskSkills(['handyman', 'garden'])).toEqual([])
  })

  it('deduplicates and normalises case', () => {
    expect(getHighRiskSkills(['Plumbing', 'plumbing', 'Gas'])).toEqual(['plumbing', 'gas'])
  })
})

describe('computeProviderQuality', () => {
  it('quality-ready when active + VERIFIED + photo + portfolio + no high-risk', () => {
    const s = computeProviderQuality(makeInput())
    expect(s.isQualityReady).toBe(true)
    expect(s.missingItems).toEqual([])
    expect(s.recommendedNudge).toBeNull()
  })

  it('not quality-ready when KYC missing — recommends KYC nudge', () => {
    const s = computeProviderQuality(makeInput({ kycStatus: 'NOT_STARTED' }))
    expect(s.isQualityReady).toBe(false)
    expect(s.missingItems).toEqual(['kyc'])
    expect(s.recommendedNudge).toBe('kyc')
  })

  it('not quality-ready when avatar missing — recommends profile_photo nudge', () => {
    const s = computeProviderQuality(makeInput({ avatarUrl: null }))
    expect(s.isQualityReady).toBe(false)
    expect(s.missingItems).toContain('profile_photo')
  })

  it('not quality-ready when portfolio empty', () => {
    const s = computeProviderQuality(makeInput({ portfolioUrls: [] }))
    expect(s.isQualityReady).toBe(false)
    expect(s.missingItems).toContain('portfolio_evidence')
  })

  it('high-risk skill without cert → not ready, cert recommended', () => {
    const s = computeProviderQuality(makeInput({ skills: ['plumbing'] }))
    expect(s.isQualityReady).toBe(false)
    expect(s.hasHighRiskSkill).toBe(true)
    expect(s.dimensions.high_risk_cert).toBe('MISSING')
    expect(s.missingItems[0]).toBe('high_risk_cert')
  })

  it('high-risk skill with VERIFIED technician cert → ready', () => {
    const s = computeProviderQuality(
      makeInput({
        skills: ['plumbing'],
        certifications: [{ code: 'plumbing-cert', status: 'VERIFIED' }],
      }),
    )
    expect(s.isQualityReady).toBe(true)
    expect(s.dimensions.high_risk_cert).toBe('PRESENT')
  })

  it('high-risk skill with EVIDENCE_UPLOADED cert → NEEDS_REVIEW, not ready', () => {
    const s = computeProviderQuality(
      makeInput({
        skills: ['plumbing'],
        certifications: [
          { code: 'plumbing-cert', status: 'EVIDENCE_UPLOADED', evidenceUrl: 'https://b/c.jpg' },
        ],
      }),
    )
    expect(s.isQualityReady).toBe(false)
    expect(s.dimensions.high_risk_cert).toBe('NEEDS_REVIEW')
  })

  it('admin-added cert with verifiedAt counts as PRESENT', () => {
    const s = computeProviderQuality(
      makeInput({
        skills: ['plumbing'],
        certifications: [
          { code: 'wireman', verifiedAt: new Date('2026-01-01'), evidenceUrl: 'https://b/c.jpg' },
        ],
      }),
    )
    expect(s.dimensions.high_risk_cert).toBe('PRESENT')
  })

  it('high_risk_cert is NOT_APPLICABLE for standard-skill providers', () => {
    const s = computeProviderQuality(makeInput({ skills: ['handyman'] }))
    expect(s.dimensions.high_risk_cert).toBe('NOT_APPLICABLE')
    expect(isDimensionSatisfied(s.dimensions.high_risk_cert)).toBe(true)
  })

  it('KYC FAILED is a distinct status (not just missing)', () => {
    const s = computeProviderQuality(makeInput({ kycStatus: 'REJECTED' }))
    expect(s.dimensions.kyc).toBe('FAILED')
    expect(s.missingItems).toContain('kyc')
  })

  it('inactive provider is never quality-ready even if every dimension PRESENT', () => {
    const s = computeProviderQuality(makeInput({ active: false }))
    expect(s.isQualityReady).toBe(false)
  })
})

describe('aggregateQualityCounts', () => {
  it('groups KYC/photo/evidence buckets correctly', () => {
    const snapshots = [
      computeProviderQuality(makeInput({ id: 'a' })),
      computeProviderQuality(makeInput({ id: 'b', kycStatus: 'NOT_STARTED' })),
      computeProviderQuality(makeInput({ id: 'c', avatarUrl: null })),
      computeProviderQuality(makeInput({ id: 'd', portfolioUrls: [], skills: ['plumbing'] })),
    ]
    const c = aggregateQualityCounts(snapshots, { a: true, b: true, c: true, d: true })
    expect(c.totalProviders).toBe(4)
    expect(c.kycVerified).toBe(3)
    expect(c.kycNotStarted).toBe(1)
    expect(c.withProfilePhoto).toBe(3)
    expect(c.missingProfilePhoto).toBe(1)
    expect(c.highRiskProviders).toBe(1)
    expect(c.highRiskMissingCert).toBe(1)
    expect(c.qualityReady).toBe(1) // only `a` is fully ready
  })
})

describe('pickNudgeDimension', () => {
  it('returns null when nothing is missing', () => {
    expect(pickNudgeDimension(computeProviderQuality(makeInput()))).toBeNull()
  })

  it('returns the single dimension when only one is missing', () => {
    expect(pickNudgeDimension(computeProviderQuality(makeInput({ kycStatus: 'NOT_STARTED' })))).toBe('kyc')
  })

  it('returns multi when 2+ dimensions are missing', () => {
    const snap = computeProviderQuality(
      makeInput({ kycStatus: 'NOT_STARTED', avatarUrl: null }),
    )
    expect(pickNudgeDimension(snap)).toBe('multi')
  })
})

describe('planNudgeForProvider', () => {
  const ctx = {
    firstName: 'Sipho',
    links: {
      kyc: 'https://app.test/provider/verify',
      profile_photo: 'https://app.test/provider/profile',
      portfolio_evidence: 'https://app.test/provider/profile/evidence',
      high_risk_cert: 'https://app.test/provider/profile/evidence',
    },
    profileLink: 'https://app.test/provider/profile',
  }

  it('uses provider_kyc_nudge template for KYC-missing providers', () => {
    const snap = computeProviderQuality(makeInput({ kycStatus: 'NOT_STARTED' }))
    const plan = planNudgeForProvider(snap, ctx)
    expect(plan?.templateName).toBe('provider_kyc_nudge')
    expect(plan?.preview).toContain('identity verification')
    expect(plan?.preview).toContain('https://app.test/provider/verify')
  })

  it('uses provider_quality_multi_nudge for 2+ missing dimensions', () => {
    const snap = computeProviderQuality(
      makeInput({ kycStatus: 'NOT_STARTED', avatarUrl: null }),
    )
    const plan = planNudgeForProvider(snap, ctx)
    expect(plan?.templateName).toBe('provider_quality_multi_nudge')
    expect(plan?.preview).toContain('Identity verification')
    expect(plan?.preview).toContain('Profile photo')
  })

  it('returns null when provider is already quality-ready', () => {
    const snap = computeProviderQuality(makeInput())
    expect(planNudgeForProvider(snap, ctx)).toBeNull()
  })

  it('uses high_risk_cert template for plumbing providers without cert', () => {
    const snap = computeProviderQuality(makeInput({ skills: ['plumbing'] }))
    const plan = planNudgeForProvider(snap, ctx)
    expect(plan?.templateName).toBe('provider_high_risk_cert_nudge')
    expect(plan?.preview).toContain('customer safety')
  })
})

describe('isRecentlyNudged', () => {
  it('returns true when a nudge of the same template fell inside the spacing window', () => {
    const now = Date.now()
    const recent = [
      {
        templateName: 'provider_kyc_nudge',
        createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      },
    ]
    expect(isRecentlyNudged(recent, 'provider_kyc_nudge')).toBe(true)
  })

  it('returns false when the most recent nudge is outside the spacing window', () => {
    const now = Date.now()
    const recent = [
      {
        templateName: 'provider_kyc_nudge',
        createdAt: new Date(now - (NUDGE_SPACING_DAYS + 1) * 24 * 60 * 60 * 1000),
      },
    ]
    expect(isRecentlyNudged(recent, 'provider_kyc_nudge')).toBe(false)
  })

  it('does not match a different template', () => {
    const recent = [{ templateName: 'provider_kyc_nudge', createdAt: new Date() }]
    expect(isRecentlyNudged(recent, 'provider_evidence_nudge')).toBe(false)
  })
})

describe('countRecentNudges', () => {
  it('counts sent nudges of the named template across history', () => {
    const recent = [
      { templateName: 'provider_kyc_nudge', createdAt: new Date() },
      { templateName: 'provider_kyc_nudge', createdAt: new Date() },
      { templateName: 'provider_evidence_nudge', createdAt: new Date() },
    ]
    expect(countRecentNudges(recent, 'provider_kyc_nudge')).toBe(2)
    expect(countRecentNudges(recent, 'provider_evidence_nudge')).toBe(1)
  })
})
