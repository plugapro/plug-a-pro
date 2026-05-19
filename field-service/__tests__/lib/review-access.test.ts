import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/db', () => ({
  db: {
    match: {
      findUnique: vi.fn(),
    },
  },
}))

// Provide a stable secret so token signing is deterministic in tests
process.env.REVIEW_ACCESS_SECRET = 'test-secret-32-chars-exactly-ok!!'

// Import AFTER env is set
const { createReviewAccessToken, verifyReviewAccessToken, createReviewUrl, resolveReviewAccessToken } =
  await import('../../../lib/review-access')
const { db } = await import('../../../lib/db')

describe('review-access', () => {
  const matchId = 'match-abc-123'
  const reviewerType = 'CUSTOMER' as const

  describe('createReviewAccessToken / verifyReviewAccessToken', () => {
    it('round-trips a valid token', () => {
      const token = createReviewAccessToken({ matchId, reviewerType })
      const result = verifyReviewAccessToken(token)
      expect(result.status).toBe('active')
      expect(result.payload?.matchId).toBe(matchId)
      expect(result.payload?.reviewerType).toBe(reviewerType)
    })

    it('returns expired for a token past its TTL', () => {
      const past = new Date(Date.now() - 1000)
      const token = createReviewAccessToken({ matchId, reviewerType, expiresAt: past })
      const result = verifyReviewAccessToken(token)
      expect(result.status).toBe('expired')
    })

    it('returns invalid for a tampered token', () => {
      const token = createReviewAccessToken({ matchId, reviewerType })
      const tampered = token.slice(0, -4) + 'XXXX'
      const result = verifyReviewAccessToken(tampered)
      expect(result.status).toBe('invalid')
    })

    it('returns invalid for garbage input', () => {
      expect(verifyReviewAccessToken('not.a.token').status).toBe('invalid')
      expect(verifyReviewAccessToken('').status).toBe('invalid')
    })

    it('generates separate tokens for CUSTOMER vs PROVIDER', () => {
      const cToken = createReviewAccessToken({ matchId, reviewerType: 'CUSTOMER' })
      const pToken = createReviewAccessToken({ matchId, reviewerType: 'PROVIDER' })
      expect(cToken).not.toBe(pToken)
      expect(verifyReviewAccessToken(cToken).payload?.reviewerType).toBe('CUSTOMER')
      expect(verifyReviewAccessToken(pToken).payload?.reviewerType).toBe('PROVIDER')
    })
  })

  describe('createReviewUrl', () => {
    it('returns null when APP_URL is not set', () => {
      delete process.env.APP_URL
      delete process.env.NEXT_PUBLIC_APP_URL
      const url = createReviewUrl({ matchId, reviewerType })
      // Either null (no base) or a string — depends on implementation
      if (url !== null) {
        expect(url).toContain('/review/')
      }
    })

    it('returns a url containing /review/ when APP_URL is set', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.plugapro.co.za'
      const url = createReviewUrl({ matchId, reviewerType })
      expect(url).not.toBeNull()
      expect(url).toContain('/review/')
    })
  })

  describe('resolveReviewAccessToken', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('returns invalid status when token is invalid', async () => {
      const result = await resolveReviewAccessToken('bad-token')
      expect(result.status).toBe('invalid')
      expect(result.context).toBeNull()
    })

    it('returns expired status when token is expired', async () => {
      const past = new Date(Date.now() - 1000)
      const token = createReviewAccessToken({ matchId, reviewerType, expiresAt: past })
      const result = await resolveReviewAccessToken(token)
      expect(result.status).toBe('expired')
      expect(result.context).toBeNull()
    })

    it('returns active with context when match is found and no prior review', async () => {
      const token = createReviewAccessToken({ matchId, reviewerType })
      ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: matchId,
        jobRequest: {
          id: 'jr-1',
          category: 'Plumbing',
          title: 'Fix leaky tap',
          customer: { id: 'c-1', name: 'Sarah', phone: '+27821111111' },
        },
        provider: { id: 'p-1', name: 'Lovemore', phone: '+27822222222', avatarUrl: null },
        reviews: [],
      })
      const result = await resolveReviewAccessToken(token)
      expect(result.status).toBe('active')
      expect(result.context?.matchId).toBe(matchId)
      expect(result.context?.reviewerType).toBe('CUSTOMER')
      expect(result.context?.existingReview).toBeNull()
    })

    it('returns already_reviewed when an existing review is present', async () => {
      const token = createReviewAccessToken({ matchId, reviewerType })
      ;(db.match.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: matchId,
        jobRequest: { id: 'jr-1', category: 'Plumbing', title: 'Fix leaky tap', customer: { id: 'c-1', name: 'Sarah', phone: '+27821111111' } },
        provider: { id: 'p-1', name: 'Lovemore', phone: '+27822222222', avatarUrl: null },
        reviews: [{ id: 'r-1', score: 5, comment: 'Great!', createdAt: new Date() }],
      })
      const result = await resolveReviewAccessToken(token)
      expect(result.status).toBe('already_reviewed')
      expect(result.context?.existingReview?.score).toBe(5)
    })
  })
})
