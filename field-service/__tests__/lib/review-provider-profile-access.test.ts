import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
    provider: { findUnique: vi.fn() },
    matchAttempt: { findFirst: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

describe('review provider profile access token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.REVIEW_PROVIDER_PROFILE_ACCESS_SECRET = 'review-profile-test-secret'
  })

  it('creates and verifies active token', async () => {
    const { createReviewProviderProfileToken, verifyReviewProviderProfileToken } = await import('../../lib/review-provider-profile-access')
    const token = createReviewProviderProfileToken({ requestId: 'req-1', providerId: 'prov-1' })
    const verified = verifyReviewProviderProfileToken(token)
    expect(verified.status).toBe('active')
    expect(verified.payload?.requestId).toBe('req-1')
    expect(verified.payload?.providerId).toBe('prov-1')
  })

  it('returns expired for a token past its exp timestamp', async () => {
    const { createReviewProviderProfileToken, verifyReviewProviderProfileToken } = await import('../../lib/review-provider-profile-access')
    const pastDate = new Date(Date.now() - 1000)
    const token = createReviewProviderProfileToken({ requestId: 'req-1', providerId: 'prov-1', expiresAt: pastDate })
    const verified = verifyReviewProviderProfileToken(token)
    expect(verified.status).toBe('expired')
    expect(verified.payload?.providerId).toBe('prov-1')
  })

  it('rejects a token with tampered payload (providerId changed)', async () => {
    const { createReviewProviderProfileToken, verifyReviewProviderProfileToken } = await import('../../lib/review-provider-profile-access')
    const token = createReviewProviderProfileToken({ requestId: 'req-1', providerId: 'prov-1' })
    const [, signature] = token.split('.')
    const tamperedPayload = Buffer.from(JSON.stringify({ v: 1, requestId: 'req-1', providerId: 'prov-EVIL', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    const tampered = `${tamperedPayload}.${signature}`
    const verified = verifyReviewProviderProfileToken(tampered)
    expect(verified.status).toBe('invalid')
  })

  it('rejects a token with stripped signature', async () => {
    const { createReviewProviderProfileToken, verifyReviewProviderProfileToken } = await import('../../lib/review-provider-profile-access')
    const token = createReviewProviderProfileToken({ requestId: 'req-1', providerId: 'prov-1' })
    const [encodedPayload] = token.split('.')
    const verified = verifyReviewProviderProfileToken(encodedPayload)
    expect(verified.status).toBe('invalid')
  })

  it('resolves active token to safe provider view data', async () => {
    const { resolveReviewProviderProfileToken, createReviewProviderProfileToken } = await import('../../lib/review-provider-profile-access')

    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'req-1',
      customerId: 'cust-1',
      status: 'PENDING_VALIDATION',
      assignmentMode: 'OPS_REVIEW',
      latestDispatchDecisionId: 'dd-1',
      category: 'plumbing',
      address: { suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng' },
      leads: [],
    })
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'prov-1',
      active: true,
      name: 'Lovemore Sibanda',
      bio: 'Reliable technician',
      avatarUrl: null,
      experience: '5+ years',
      serviceAreas: ['Sandton'],
      skills: ['plumbing'],
      verified: true,
      averageRating: 4.7,
      completedJobsCount: 120,
      portfolioUrls: [],
      providerCategories: [],
      providerRates: [],
    })
    mockDb.matchAttempt.findFirst.mockResolvedValue({
      score: 0.88,
      reasonCode: null,
      feasibilityNotes: ['Works in your area and handles plumbing jobs.'],
    })

    const token = createReviewProviderProfileToken({ requestId: 'req-1', providerId: 'prov-1' })
    const resolved = await resolveReviewProviderProfileToken(token)
    expect(resolved.status).toBe('active')
    expect(resolved.provider?.name).toBe('Lovemore Sibanda')
    expect(resolved.matchReason).toContain('area')
  })
})
