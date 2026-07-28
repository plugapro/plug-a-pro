import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockDbReviewCreate, mockResolveReviewAccessToken } = vi.hoisted(() => {
  const mockDbReviewCreate = vi.fn()
  // CJ-02: submitReview now resolves linkage (match.findUnique), writes inside
  // $transaction and recomputes the provider average (job.findMany,
  // review.findMany, provider.updateMany on the tx client).
  const tx = {
    review: { create: mockDbReviewCreate, findMany: vi.fn() },
    job: { findMany: vi.fn() },
    provider: { updateMany: vi.fn() },
  }
  const mockDb = {
    tx,
    review: { create: mockDbReviewCreate },
    match: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)),
  }
  return { mockDb, mockDbReviewCreate, mockResolveReviewAccessToken: vi.fn() }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
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
  mockDb.match.findUnique.mockResolvedValue({
    id: 'match-1',
    providerId: 'p-1',
    booking: { job: { id: 'job-1' } },
  })
  mockDb.tx.job.findMany.mockResolvedValue([{ id: 'job-1' }])
  mockDb.tx.review.findMany.mockResolvedValue([{ id: 'review-1', score: 5 }])
  mockDb.tx.provider.updateMany.mockResolvedValue({ count: 1 })
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
