// ─── Candidate Pool Rebuild Cron ──────────────────────────────────────────────
// Rebuilds the candidate_pool table for all active categories.
// Runs every 5 minutes during operational hours via Vercel Cron.
// Also invoked directly after provider profile updates.
//
// Add to vercel.json:
//   { "path": "/api/internal/cron/rebuild-candidate-pool", "schedule": "*/5 6-22 * * *" }

import { NextResponse } from 'next/server'
import { CATEGORY_POLICIES } from '@/lib/service-category-policy'
import { rebuildCandidatePoolForCategory } from '@/lib/matching/candidate-pool'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const start = Date.now()
  const categorySlugs = Object.keys(CATEGORY_POLICIES)
  const results: Record<string, number> = {}

  for (const slug of categorySlugs) {
    try {
      results[slug] = await rebuildCandidatePoolForCategory(slug)
    } catch (err) {
      console.error('[rebuild-candidate-pool] failed for category', { slug, err })
      results[slug] = -1
    }
  }

  console.log('[rebuild-candidate-pool] done', { latencyMs: Date.now() - start, results })

  return NextResponse.json({ ok: true, latencyMs: Date.now() - start, results })
}

// Allow Vercel Cron GET calls as well
export const GET = POST
