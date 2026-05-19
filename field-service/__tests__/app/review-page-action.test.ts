import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../lib/db', () => ({
  db: {
    review: {
      create: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/review-access', () => ({
  resolveReviewAccessToken: vi.fn(),
}))

// next/navigation mocks
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))

const { submitReview } = await import('../../../app/review/[token]/actions')
const { db } = await import('../../../lib/db')
const { resolveReviewAccessToken } = await import('../../../lib/review-access')

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
  ;(db.review.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'review-1' })
})

describe('submitReview', () => {
  it('creates a review on valid input', async () => {
    ;(resolveReviewAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'active',
      payload: { matchId: 'match-1', reviewerType: 'CUSTOMER' },
      context: validContext,
    })

    const formData = new FormData()
    formData.set('score', '5')
    formData.set('comment', 'Great work!')
    formData.set('token', 'valid-token')

    // submitReview redirects on success — catch the redirect
    await expect(submitReview(formData)).rejects.toThrow('REDIRECT:/review/valid-token/thanks')

    expect(db.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          score: 5,
          comment: 'Great work!',
          matchId: 'match-1',
          reviewerType: 'CUSTOMER',
        }),
      })
    )
  })

  it('throws on invalid score (< 1)', async () => {
    ;(resolveReviewAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'active',
      payload: { matchId: 'match-1', reviewerType: 'CUSTOMER' },
      context: validContext,
    })

    const formData = new FormData()
    formData.set('score', '0')
    formData.set('token', 'valid-token')

    await expect(submitReview(formData)).rejects.toThrow()
    expect(db.review.create).not.toHaveBeenCalled()
  })

  it('throws on invalid score (> 5)', async () => {
    ;(resolveReviewAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'active',
      payload: { matchId: 'match-1', reviewerType: 'CUSTOMER' },
      context: validContext,
    })

    const formData = new FormData()
    formData.set('score', '6')
    formData.set('token', 'valid-token')

    await expect(submitReview(formData)).rejects.toThrow()
    expect(db.review.create).not.toHaveBeenCalled()
  })

  it('throws when token resolves to invalid', async () => {
    ;(resolveReviewAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'invalid',
      payload: null,
      context: null,
    })

    const formData = new FormData()
    formData.set('score', '4')
    formData.set('token', 'bad-token')

    await expect(submitReview(formData)).rejects.toThrow()
    expect(db.review.create).not.toHaveBeenCalled()
  })

  it('is idempotent — skips create when existingReview is present', async () => {
    ;(resolveReviewAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'already_reviewed',
      payload: { matchId: 'match-1', reviewerType: 'CUSTOMER' },
      context: { ...validContext, existingReview: { id: 'r-1', score: 5, comment: 'Great!', createdAt: new Date() } },
    })

    const formData = new FormData()
    formData.set('score', '3')
    formData.set('token', 'valid-token')

    // Should redirect to thanks without creating a duplicate review
    await expect(submitReview(formData)).rejects.toThrow('REDIRECT:/review/valid-token/thanks')
    expect(db.review.create).not.toHaveBeenCalled()
  })
})
