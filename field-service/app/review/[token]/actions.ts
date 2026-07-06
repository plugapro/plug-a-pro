'use server'
import { resolveReviewAccessToken } from '@/lib/review-access'
import { db } from '@/lib/db'
import { resolveReviewLinkage, recomputeProviderAverageRating } from '@/lib/review-rating'

export async function submitReview(params: { token: string; score: number; comment?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { score, comment } = params
  if (!Number.isInteger(score) || score < 1 || score > 5) return { ok: false, error: 'Invalid score.' }
  const resolved = await resolveReviewAccessToken(params.token)
  if (resolved.status !== 'active' || !resolved.context) return { ok: false, error: 'This review link is no longer valid.' }
  const { matchId, reviewerType, customer, provider } = resolved.context
  if (resolved.context.existingReview) return { ok: false, error: 'You have already submitted a review for this job.' }

  // CJ-02: populate BOTH matchId and jobId (jobId via match → booking → job)
  // so jobId-based readers (profile aggregation, follow-up dedup) see this
  // review, and recompute the provider's averageRating in the same
  // transaction so the trust loop actually moves.
  const linkage = await resolveReviewLinkage(db, { matchId })
  await db.$transaction(async (tx) => {
    await tx.review.create({
      data: {
        matchId,
        jobId: linkage.jobId,
        reviewerType,
        customerId: reviewerType === 'CUSTOMER' ? customer.id : null,
        providerId: reviewerType === 'PROVIDER' ? provider.id : null,
        score,
        comment: comment ?? null,
      },
    })
    if (reviewerType === 'CUSTOMER') {
      // Subject of a customer review is the matched provider.
      await recomputeProviderAverageRating(tx, provider.id)
    }
  })
  return { ok: true }
}
