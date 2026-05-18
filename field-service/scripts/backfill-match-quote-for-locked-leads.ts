// Materialises Match + stub Quote rows for any Lead that was set to
// ACCEPTED_LOCKED *before* the post-lock fulfilment helper went live.
// Without this, those providers see "0 jobs" in /provider/jobs because the
// page queries Match-based artifacts and there's nothing to surface.
//
// Idempotent — safe to re-run. Uses Match.jobRequestId @unique as the anchor.
//
// Usage:
//   pnpm tsx scripts/backfill-match-quote-for-locked-leads.ts            # dry-run
//   pnpm tsx scripts/backfill-match-quote-for-locked-leads.ts --apply    # write

import { db } from '../lib/db'
import { materializeFulfilmentArtifacts } from '../lib/post-lock-fulfilment'

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)

  const candidates = await db.lead.findMany({
    where: {
      status: 'ACCEPTED_LOCKED',
      jobRequest: { match: { is: null } },
    },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
      provider: { select: { name: true } },
      jobRequest: { select: { category: true, requestRef: true } },
    },
    orderBy: { providerAcceptedAt: 'asc' },
  })

  console.log(`[backfill] found ${candidates.length} locked lead(s) missing a Match row`)
  if (candidates.length === 0) {
    console.log('[backfill] nothing to do — exiting')
    return
  }

  for (const lead of candidates) {
    const tag = `${lead.provider?.name ?? '<unknown>'} · ${lead.jobRequest.category} · ${lead.jobRequest.requestRef ?? lead.id.slice(-6)}`
    if (!apply) {
      console.log(`[backfill] DRY-RUN would materialise: ${tag} (leadId=${lead.id})`)
      continue
    }
    try {
      const result = await db.$transaction(async (tx) =>
        materializeFulfilmentArtifacts(tx, {
          jobRequestId: lead.jobRequestId,
          providerId: lead.providerId,
        }),
      )
      console.log(
        `[backfill] materialised: ${tag} matchId=${result.matchId} quoteId=${result.quoteId} alreadyMaterialised=${result.alreadyMaterialised}`,
      )
    } catch (err) {
      console.error(
        `[backfill] failed: ${tag} leadId=${lead.id} error=${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  console.log('[backfill] done')
}

main()
  .catch((err) => {
    console.error('[backfill] fatal', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
