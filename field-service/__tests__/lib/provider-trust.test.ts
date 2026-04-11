import { describe, expect, it } from 'vitest'
import {
  buildProviderTrustSignals,
  getProviderMarketplaceReviewDescription,
  getProviderMarketplaceReviewLabel,
  getProviderTrustProvenanceLabel,
} from '../../lib/provider-trust'

describe('provider trust helpers', () => {
  it('labels marketplace-approved providers without implying competence verification', () => {
    expect(getProviderMarketplaceReviewLabel(true)).toBe('Application reviewed by Plug-A-Pro')
  })

  it('labels non-approved profiles as provider-supplied', () => {
    expect(getProviderMarketplaceReviewLabel(false)).toBe('Provider-supplied profile')
  })

  it('describes provider-supplied data and platform-recorded evidence honestly', () => {
    expect(getProviderMarketplaceReviewDescription()).toContain('supplied by the provider')
    expect(getProviderMarketplaceReviewDescription()).toContain('does not claim licensing')
    expect(getProviderMarketplaceReviewDescription()).toContain('workmanship guarantees')
  })

  it('labels provenance explicitly', () => {
    expect(getProviderTrustProvenanceLabel('provider-shared-evidence')).toBe('Provider-shared evidence')
    expect(getProviderTrustProvenanceLabel('platform-recorded')).toBe('Platform-recorded')
  })

  it('builds structured trust signals with explicit provenance', () => {
    const signals = buildProviderTrustSignals({
      marketplaceApproved: true,
      skills: ['Plumbing'],
      serviceAreas: ['Soweto'],
      experience: '3–5 years',
      evidenceNote: 'Can share photos from kitchen and bathroom jobs on request.',
      completedJobs: 12,
      reviewCount: 5,
      averageRating: 4.6,
    })

    expect(signals.some((signal) => signal.provenance === 'provider-supplied')).toBe(true)
    expect(signals.some((signal) => signal.provenance === 'provider-shared-evidence')).toBe(true)
    expect(signals.some((signal) => signal.provenance === 'platform-recorded')).toBe(true)
    expect(signals.some((signal) => signal.provenance === 'marketplace-review')).toBe(true)
  })
})
