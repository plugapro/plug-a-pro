// ─── Review linkage + provider rating recompute ───────────────────────────────
// CJ-02 (platform audit 2026-07-06): the ratings loop was dead —
//   - Provider.averageRating was read by matching / shortlists but never
//     recomputed from Review rows.
//   - Review writes were forked: /review/[token] wrote matchId-only rows while
//     /bookings/[id]/rate wrote jobId-only rows, so each reader (jobId-based
//     profile aggregation, follow-up dedup) saw only half the data.
//
// This module unifies the two:
//   - resolveReviewLinkage(): given either key, resolves BOTH keys plus the
//     subject provider id via match → booking → job (or job → booking → match).
//   - recomputeProviderAverageRating(): recomputes Provider.averageRating from
//     ALL customer reviews for that provider, tolerating rows written with
//     either key (deduped by review id).
//
// New review writes should call resolveReviewLinkage() and persist BOTH keys,
// then recompute inside the same transaction.

// Relation fields are optional so the real PrismaClient (whose default
// findUnique return type omits relations unless selected) is structurally
// assignable without casts; at runtime the select in each query guarantees
// the relation is present.
type LinkageClient = {
  match?: {
    findUnique: (args: any) => Promise<{
      id: string
      providerId: string
      booking?: { job: { id: string } | null } | null
    } | null>
  }
  job?: {
    findUnique: (args: any) => Promise<{
      id: string
      providerId: string
      booking?: { matchId: string } | null
    } | null>
  }
}

export type ReviewLinkage = {
  matchId: string | null
  jobId: string | null
  providerId: string | null
}

export async function resolveReviewLinkage(
  client: LinkageClient,
  input: { matchId?: string | null; jobId?: string | null },
): Promise<ReviewLinkage> {
  if (input.matchId && client.match?.findUnique) {
    const match = await client.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        providerId: true,
        booking: { select: { job: { select: { id: true } } } },
      },
    })
    if (match) {
      return {
        matchId: match.id,
        jobId: match.booking?.job?.id ?? input.jobId ?? null,
        providerId: match.providerId,
      }
    }
  }

  if (input.jobId && client.job?.findUnique) {
    const job = await client.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        providerId: true,
        booking: { select: { matchId: true } },
      },
    })
    if (job) {
      return {
        matchId: job.booking?.matchId ?? input.matchId ?? null,
        jobId: job.id,
        providerId: job.providerId,
      }
    }
  }

  return { matchId: input.matchId ?? null, jobId: input.jobId ?? null, providerId: null }
}

type RecomputeClient = {
  job: { findMany: (args: any) => Promise<Array<{ id: string }>> }
  review: { findMany: (args: any) => Promise<Array<{ id: string; score: number }>> }
  provider: { updateMany: (args: any) => Promise<unknown> }
}

export type ProviderRatingRecomputeResult = {
  providerId: string
  averageRating: number
  reviewCount: number
}

/**
 * Recompute Provider.averageRating from ALL customer reviews about this
 * provider, whether the row carries matchId, jobId, or both. Safe to run
 * inside a transaction (pass the tx client).
 */
export async function recomputeProviderAverageRating(
  client: RecomputeClient,
  providerId: string,
): Promise<ProviderRatingRecomputeResult> {
  const jobs = await client.job.findMany({
    where: { providerId },
    select: { id: true },
  })
  const jobIds = jobs.map((j) => j.id)

  // OR across both keys in one query: rows appear once even when both keys
  // are set (single-table scan, no client-side dedupe needed).
  const reviews = await client.review.findMany({
    where: {
      reviewerType: 'CUSTOMER',
      OR: [
        { match: { providerId } },
        ...(jobIds.length > 0 ? [{ jobId: { in: jobIds } }] : []),
      ],
    },
    select: { id: true, score: true },
  })

  // Defensive dedupe by review id (protects against clients/mocks that return
  // overlapping rows for the OR branches).
  const seen = new Set<string>()
  let sum = 0
  let count = 0
  for (const review of reviews) {
    if (seen.has(review.id)) continue
    seen.add(review.id)
    sum += review.score
    count += 1
  }

  const averageRating = count > 0 ? Math.round((sum / count) * 100) / 100 : 0

  await client.provider.updateMany({
    where: { id: providerId },
    data: { averageRating },
  })

  return { providerId, averageRating, reviewCount: count }
}
