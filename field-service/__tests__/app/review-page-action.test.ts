import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbReviewCreate, mockResolveReviewAccessToken } = vi.hoisted(() => ({
  mockDbReviewCreate: vi.fn(),
  mockResolveReviewAccessToken: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: { review: { create: mockDbReviewCreate } } }))
vi.mock('../../lib/review-access', () => ({ resolveReviewAccessToken: mockResolveReviewAccessToken }))

import { submitReview } from '../../app/review/[token]/actions'

const validContext = {
  matchId: 'match-1',
  reviewerType: 'CUSTOMER' as const,
  jobCategory: 'Plumbing',
  jobTitle: 'Fix leaky tap',
  jobRequestId: 'jr-1',
  customer: { id: 'c-1', name: 'Sarah', phone: '+27821111111' },
  provider: { id: 'p-1', name: 'Lovemore', phone: '+27822222222', avatarUrl: null },
  existingReview: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDbReviewCreate.mockResolvedValue({ id: 'review-1' })
})

describe('submitReview', () => {
  it('creates a review and returns ok:true on valid input', async () => {
    mockResolveReviewAccessToken.mockResolvedValue({ status: 'active', payload: { matchId: 'match-1', reviewerType: 'CUSTOMER' }, context: validContext })

    const result = await submitReview({ token: 'valid-token', score: 5, comment: 'Great work!' })

    expect(result).toEqual({ ok: true })
    expect(mockDbReviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 5, comment: 'Great work!', matchId: 'match-1', reviewerType: 'CUSTOMER' }),
      })
    )
  })

  it('returns ok:false on invalid score (< 1)', async () => {
    const result = await submitReview({ token: 'valid-token', score: 0 })
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mockDbReviewCreate).not.toHaveBeenCalled()
  })

  it('returns ok:false on invalid score (> 5)', async () => {
    const result = await submitReview({ token: 'valid-token', score: 6 })
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mockDbReviewCreate).not.toHaveBeenCalled()
  })

  it('returns ok:false when token resolves to invalid', async () => {
    mockResolveReviewAccessToken.mockResolvedValue({ status: 'invalid', payload: null, context: null })
    const result = await submitReview({ token: 'bad-token', score: 4 })
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mockDbReviewCreate).not.toHaveBeenCalled()
  })

  it('returns ok:false when token is expired', async () => {
    mockResolveReviewAccessToken.mockResolvedValue({ status: 'expired', payload: null, context: null })
    const result = await submitReview({ token: 'expired-token', score: 4 })
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mockDbReviewCreate).not.toHaveBeenCalled()
  })

  it('is idempotent - returns ok:false when existingReview is present', async () => {
    mockResolveReviewAccessToken.mockResolvedValue({
      status: 'active',
      payload: { matchId: 'match-1', reviewerType: 'CUSTOMER' },
      context: { ...validContext, existingReview: { id: 'r-1', score: 5, comment: 'Great!', createdAt: new Date() } },
    })
    const result = await submitReview({ token: 'valid-token', score: 3 })
    expect(result).toEqual({ ok: false, error: expect.any(String) })
    expect(mockDbReviewCreate).not.toHaveBeenCalled()
  })

  it('sets providerId when reviewerType is PROVIDER', async () => {
    mockResolveReviewAccessToken.mockResolvedValue({
      status: 'active',
      payload: { matchId: 'match-1', reviewerType: 'PROVIDER' },
      context: { ...validContext, reviewerType: 'PROVIDER' as const },
    })
    const result = await submitReview({ token: 'valid-token', score: 4 })
    expect(result).toEqual({ ok: true })
    expect(mockDbReviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewerType: 'PROVIDER', providerId: 'p-1', customerId: null }),
      })
    )
  })
})
