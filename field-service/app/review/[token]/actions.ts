'use server'
import { resolveReviewAccessToken } from '@/lib/review-access'
import { db } from '@/lib/db'
export async function submitReview(params: { token: string; score: number; comment?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { score, comment } = params
  if (!Number.isInteger(score) || score < 1 || score > 5) return { ok: false, error: 'Invalid score.' }
  const resolved = await resolveReviewAccessToken(params.token)
  if (resolved.status !== 'active' || !resolved.context) return { ok: false, error: 'This review link is no longer valid.' }
  const { matchId, reviewerType, customer, provider } = resolved.context
  if (resolved.context.existingReview) return { ok: false, error: 'You have already submitted a review for this job.' }
  await db.review.create({ data: { matchId, reviewerType, customerId: reviewerType === 'CUSTOMER' ? customer.id : null, providerId: reviewerType === 'PROVIDER' ? provider.id : null, score, comment: comment ?? null } })
  return { ok: true }
}
