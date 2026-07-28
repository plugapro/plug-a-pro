import { describe, expect, it, vi } from 'vitest'

import { resolveReviewLinkage, recomputeProviderAverageRating } from '@/lib/review-rating'

describe('resolveReviewLinkage', () => {
  it('resolves jobId + providerId from a matchId via match → booking → job', async () => {
    const client = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'match-1',
          providerId: 'prov-1',
          booking: { job: { id: 'job-1' } },
        }),
      },
      job: { findUnique: vi.fn() },
    }

    const linkage = await resolveReviewLinkage(client, { matchId: 'match-1' })

    expect(linkage).toEqual({ matchId: 'match-1', jobId: 'job-1', providerId: 'prov-1' })
    expect(client.job.findUnique).not.toHaveBeenCalled()
  })

  it('tolerates a match with no booking/job yet (jobId stays null)', async () => {
    const client = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'match-2',
          providerId: 'prov-2',
          booking: null,
        }),
      },
    }

    const linkage = await resolveReviewLinkage(client, { matchId: 'match-2' })

    expect(linkage).toEqual({ matchId: 'match-2', jobId: null, providerId: 'prov-2' })
  })

  it('resolves matchId + providerId from a jobId via job → booking', async () => {
    const client = {
      job: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-3',
          providerId: 'prov-3',
          booking: { matchId: 'match-3' },
        }),
      },
    }

    const linkage = await resolveReviewLinkage(client, { jobId: 'job-3' })

    expect(linkage).toEqual({ matchId: 'match-3', jobId: 'job-3', providerId: 'prov-3' })
  })

  it('returns pass-through keys when nothing resolves', async () => {
    const client = {
      match: { findUnique: vi.fn().mockResolvedValue(null) },
      job: { findUnique: vi.fn().mockResolvedValue(null) },
    }

    const linkage = await resolveReviewLinkage(client, { matchId: 'ghost' })

    expect(linkage).toEqual({ matchId: 'ghost', jobId: null, providerId: null })
  })
})

describe('recomputeProviderAverageRating', () => {
  it('averages customer reviews found through EITHER key and persists the result', async () => {
    const client = {
      job: { findMany: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]) },
      review: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', score: 5 }, // matchId-only legacy row
          { id: 'r2', score: 4 }, // jobId-only legacy row
          { id: 'r3', score: 3 }, // dual-key row
        ]),
      },
      provider: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }

    const result = await recomputeProviderAverageRating(client, 'prov-1')

    expect(result).toEqual({ providerId: 'prov-1', averageRating: 4, reviewCount: 3 })
    expect(client.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reviewerType: 'CUSTOMER',
          OR: [
            { match: { providerId: 'prov-1' } },
            { jobId: { in: ['job-1', 'job-2'] } },
          ],
        }),
      }),
    )
    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov-1' },
      data: { averageRating: 4 },
    })
  })

  it('dedupes rows returned twice (defensive against overlapping OR branches)', async () => {
    const client = {
      job: { findMany: vi.fn().mockResolvedValue([]) },
      review: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', score: 5 },
          { id: 'r1', score: 5 },
          { id: 'r2', score: 2 },
        ]),
      },
      provider: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }

    const result = await recomputeProviderAverageRating(client, 'prov-2')

    expect(result.reviewCount).toBe(2)
    expect(result.averageRating).toBe(3.5)
  })

  it('resets averageRating to 0 when no customer reviews exist', async () => {
    const client = {
      job: { findMany: vi.fn().mockResolvedValue([]) },
      review: { findMany: vi.fn().mockResolvedValue([]) },
      provider: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }

    const result = await recomputeProviderAverageRating(client, 'prov-3')

    expect(result).toEqual({ providerId: 'prov-3', averageRating: 0, reviewCount: 0 })
    expect(client.provider.updateMany).toHaveBeenCalledWith({
      where: { id: 'prov-3' },
      data: { averageRating: 0 },
    })
  })

  it('rounds to two decimals', async () => {
    const client = {
      job: { findMany: vi.fn().mockResolvedValue([]) },
      review: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'r1', score: 5 },
          { id: 'r2', score: 4 },
          { id: 'r3', score: 4 },
        ]),
      },
      provider: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }

    const result = await recomputeProviderAverageRating(client, 'prov-4')

    expect(result.averageRating).toBe(4.33)
  })
})
