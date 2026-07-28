/**
 * Backfill review linkage + provider average ratings (CJ-02, platform audit
 * 2026-07-06).
 *
 * Phase 1 — link legacy reviews:
 *   - matchId-only rows: resolve jobId via match → booking → job.
 *   - jobId-only rows:   resolve matchId via job → booking.matchId.
 *   Rows are only ever filled in (null → value); existing keys are never
 *   changed. A fill is skipped when it would collide with the
 *   @@unique([jobId, reviewerType]) / @@unique([matchId, reviewerType])
 *   constraints (i.e. a duplicate review already exists under the other key).
 *
 * Phase 2 — recompute Provider.averageRating for every provider that has at
 *   least one customer review (post-linkage), using the shared
 *   recomputeProviderAverageRating helper.
 *
 * Flags:
 *   --execute    apply changes (default is DRY-RUN)
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-review-links-and-ratings.ts
 *   pnpm exec tsx scripts/backfill-review-links-and-ratings.ts --execute
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { resolveReviewLinkage, recomputeProviderAverageRating } from '../lib/review-rating'

const EXECUTE = process.argv.includes('--execute')

async function linkLegacyReviews() {
  console.log('\n--- phase 1: link legacy reviews ---')
  const partialReviews = await db.review.findMany({
    where: {
      OR: [
        { jobId: null, matchId: { not: null } },
        { matchId: null, jobId: { not: null } },
      ],
    },
    select: { id: true, jobId: true, matchId: true, reviewerType: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`found ${partialReviews.length} reviews with only one key set`)

  let linked = 0
  let unresolvable = 0
  let skippedConflict = 0

  for (const review of partialReviews) {
    const linkage = await resolveReviewLinkage(db, {
      matchId: review.matchId,
      jobId: review.jobId,
    })

    const fillJobId = review.jobId == null && linkage.jobId != null
    const fillMatchId = review.matchId == null && linkage.matchId != null
    if (!fillJobId && !fillMatchId) {
      unresolvable += 1
      console.log(`? review=${review.id} — cannot resolve missing key (matchId=${review.matchId ?? '-'} jobId=${review.jobId ?? '-'})`)
      continue
    }

    // Unique-constraint pre-check: another review of the same reviewerType may
    // already exist under the key we are about to fill.
    if (fillJobId && linkage.jobId) {
      const conflict = await db.review.findFirst({
        where: { jobId: linkage.jobId, reviewerType: review.reviewerType, id: { not: review.id } },
        select: { id: true },
      })
      if (conflict) {
        skippedConflict += 1
        console.log(`! review=${review.id} — jobId fill would collide with review=${conflict.id}; skipped`)
        continue
      }
    }
    if (fillMatchId && linkage.matchId) {
      const conflict = await db.review.findFirst({
        where: { matchId: linkage.matchId, reviewerType: review.reviewerType, id: { not: review.id } },
        select: { id: true },
      })
      if (conflict) {
        skippedConflict += 1
        console.log(`! review=${review.id} — matchId fill would collide with review=${conflict.id}; skipped`)
        continue
      }
    }

    const data: { jobId?: string; matchId?: string } = {}
    if (fillJobId && linkage.jobId) data.jobId = linkage.jobId
    if (fillMatchId && linkage.matchId) data.matchId = linkage.matchId

    if (EXECUTE) {
      await db.review.update({ where: { id: review.id }, data })
      console.log(`✓ review=${review.id} — filled ${Object.keys(data).join(', ')}`)
    } else {
      console.log(`+ review=${review.id} — WOULD fill ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    }
    linked += 1
  }

  console.log(`\nphase 1 summary: ${EXECUTE ? 'linked' : 'would link'}=${linked} unresolvable=${unresolvable} skippedConflict=${skippedConflict}`)
}

async function recomputeAllRatings() {
  console.log('\n--- phase 2: recompute provider average ratings ---')

  // Providers referenced by customer reviews through either key.
  const reviewMatches = await db.review.findMany({
    where: { reviewerType: 'CUSTOMER', matchId: { not: null } },
    select: { match: { select: { providerId: true } } },
  })
  const reviewJobRows = await db.review.findMany({
    where: { reviewerType: 'CUSTOMER', jobId: { not: null } },
    select: { jobId: true },
  })
  const jobRows = await db.job.findMany({
    where: { id: { in: reviewJobRows.map((r) => r.jobId as string) } },
    select: { providerId: true },
  })

  const providerIds = new Set<string>()
  for (const row of reviewMatches) {
    if (row.match?.providerId) providerIds.add(row.match.providerId)
  }
  for (const row of jobRows) providerIds.add(row.providerId)

  console.log(`recomputing averageRating for ${providerIds.size} provider(s)`)

  for (const providerId of providerIds) {
    if (EXECUTE) {
      const result = await recomputeProviderAverageRating(db, providerId)
      console.log(`✓ provider=${providerId} averageRating=${result.averageRating} (${result.reviewCount} review(s))`)
    } else {
      // Dry-run: compute without writing.
      const current = await db.provider.findUnique({
        where: { id: providerId },
        select: { averageRating: true },
      })
      const jobs = await db.job.findMany({ where: { providerId }, select: { id: true } })
      const reviews = await db.review.findMany({
        where: {
          reviewerType: 'CUSTOMER',
          OR: [
            { match: { providerId } },
            ...(jobs.length > 0 ? [{ jobId: { in: jobs.map((j) => j.id) } }] : []),
          ],
        },
        select: { id: true, score: true },
      })
      const avg = reviews.length > 0
        ? Math.round((reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length) * 100) / 100
        : 0
      console.log(`+ provider=${providerId} WOULD set averageRating=${avg} (currently ${current?.averageRating ?? '-'}; ${reviews.length} review(s))`)
    }
  }
}

async function main() {
  console.log('--- backfill-review-links-and-ratings ---')
  console.log(`mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`)
  await linkLegacyReviews()
  await recomputeAllRatings()
  if (!EXECUTE) console.log('\n(dry-run; pass --execute to apply)')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
