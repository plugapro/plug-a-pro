import { beforeEach, describe, expect, it, vi } from 'vitest'

// CJ-02: /review/[token] submissions must write BOTH matchId and jobId and
// recompute the provider's averageRating in the same transaction.

const { mockDb, mockResolveReviewAccessToken } = vi.hoisted(() => {
  const tx = {
    review: { create: vi.fn(), findMany: vi.fn() },
    job: { findMany: vi.fn() },
    provider: { updateMany: vi.fn() },
  }
  const mockDb = {
    tx,
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)),
    match: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
  }
  return { mockDb, mockResolveReviewAccessToken: vi.fn() }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/review-access', () => ({ resolveReviewAccessToken: mockResolveReviewAccessToken }))

import { submitReview } from '@/app/review/[token]/actions'

const activeContext = {
  status: 'active' as const,
  payload: null,
  context: {
    matchId: 'match-1',
    reviewerType: 'CUSTOMER' as const,
    jobCategory: 'plumbing',
    jobTitle: 'Fix geyser',
    jobRequestId: 'jr-1',
    customer: { id: 'cust-1', name: 'Thandi', phone: '+27820000001' },
    provider: { id: 'prov-1', name: 'Sipho', phone: '+27820000002', avatarUrl: null },
    existingReview: null,
  },
}

describe('submitReview (review token action)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveReviewAccessToken.mockResolvedValue(activeContext)
    // resolveReviewLinkage: match → booking → job
    mockDb.match.findUnique.mockResolvedValue({
      id: 'match-1',
      providerId: 'prov-1',
      booking: { job: { id: 'job-1' } },
    })
    mockDb.tx.review.create.mockResolvedValue({ id: 'rev-1' })
    mockDb.tx.job.findMany.mockResolvedValue([{ id: 'job-1' }])
    mockDb.tx.review.findMany.mockResolvedValue([{ id: 'rev-1', score: 5 }])
    mockDb.tx.provider.updateMany.mockResolvedValue({ count: 1 })
  })

  it('writes BOTH matchId and jobId and recomputes the provider average in the same transaction', async () => {
    const result = await submitReview({ token: 'tok', score: 5, comment: 'Great' })

    expect(result).toEqual({ ok: true })
    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    expect(mockDb.tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matchId: 'match-1',
        jobId: 'job-1',
        reviewerType: 'CUSTOMER',
        customerId: 'cust-1',
        providerId: null,
        score: 5,
      }),
    })
    // Recompute ran against the tx client and persisted the new average.
    expect(mockDb.tx.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov-1' },
      data: { averageRating: 5 },
    })
  })

  it('still writes matchId with jobId=null when the match has no booking/job yet', async () => {
    mockDb.match.findUnique.mockResolvedValue({ id: 'match-1', providerId: 'prov-1', booking: null })

    const result = await submitReview({ token: 'tok', score: 4 })

    expect(result).toEqual({ ok: true })
    expect(mockDb.tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matchId: 'match-1', jobId: null }),
    })
  })

  it('does NOT recompute the provider average for provider-authored reviews of customers', async () => {
    mockResolveReviewAccessToken.mockResolvedValue({
      ...activeContext,
      context: { ...activeContext.context, reviewerType: 'PROVIDER' as const },
    })

    const result = await submitReview({ token: 'tok', score: 4 })

    expect(result).toEqual({ ok: true })
    expect(mockDb.tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ reviewerType: 'PROVIDER', providerId: 'prov-1', customerId: null }),
    })
    expect(mockDb.tx.provider.updateMany).not.toHaveBeenCalled()
  })

  it('rejects invalid scores and duplicate reviews unchanged', async () => {
    expect(await submitReview({ token: 'tok', score: 0 })).toEqual({ ok: false, error: 'Invalid score.' })

    mockResolveReviewAccessToken.mockResolvedValue({
      ...activeContext,
      context: { ...activeContext.context, existingReview: { id: 'rev-existing' } },
    })
    expect(await submitReview({ token: 'tok', score: 5 })).toEqual({
      ok: false,
      error: 'You have already submitted a review for this job.',
    })
    expect(mockDb.tx.review.create).not.toHaveBeenCalled()
  })
})
