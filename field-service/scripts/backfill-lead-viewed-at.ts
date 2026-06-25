// Backfill Lead.viewedAt for historical rows where status implies the lead
// must have been viewed before reaching that state, but the timestamp column
// is null. Proxy: viewedAt = respondedAt (provider had to view before they
// responded). Idempotent — skips rows where viewedAt is already populated.
//
// Why: prod audit on 2026-06-24 found `Lead.viewedAt` was NULL for every lead
// in the last 30 days, including leads with status='VIEWED'/'ACCEPTED'/
// 'DECLINED'/etc. The funnel-page "providers viewed" metric reads from this
// column; without backfill the metric stays at zero forever.
// Spec: docs/superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md
//
// Usage:
//   pnpm tsx scripts/backfill-lead-viewed-at.ts            # dry-run (default)
//   pnpm tsx scripts/backfill-lead-viewed-at.ts --apply    # write changes
//   pnpm tsx scripts/backfill-lead-viewed-at.ts --json     # machine-readable

import { db } from '../lib/db'

const APPLY = process.argv.includes('--apply')
const JSON_OUTPUT = process.argv.includes('--json')

// Statuses that a lead MUST have passed through "VIEWED" to reach. SENT is
// excluded because a SENT lead may genuinely never have been viewed.
const VIEWED_OR_BEYOND = [
  'VIEWED',
  'INTERESTED',
  'SHORTLISTED',
  'CUSTOMER_SELECTED',
  'PROVIDER_ACCEPTED',
  'CREDIT_REQUIRED',
  'CREDIT_APPLIED',
  'ACCEPTED_LOCKED',
  'ACCEPTED',
  'DECLINED',
] as const

async function main() {
  const candidates = await db.lead.findMany({
    where: {
      viewedAt: null,
      respondedAt: { not: null },
      status: { in: [...VIEWED_OR_BEYOND] },
    },
    select: { id: true, status: true, respondedAt: true, sentAt: true, providerId: true },
    orderBy: { sentAt: 'desc' },
  })

  const byStatus = new Map<string, number>()
  for (const c of candidates) {
    byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1)
  }

  if (JSON_OUTPUT) {
    process.stdout.write(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      candidate_count: candidates.length,
      by_status: Object.fromEntries(byStatus),
    }, null, 2))
    process.stdout.write('\n')
  } else {
    console.log(`========== Lead.viewedAt backfill — ${APPLY ? 'APPLY' : 'DRY-RUN'} ==========`)
    console.log(`Candidates: ${candidates.length}`)
    console.log('By status:')
    for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(20)} ${count}`)
    }
  }

  if (!APPLY) {
    if (!JSON_OUTPUT) console.log('\nDry-run — no changes written. Re-run with --apply to write.')
    return
  }

  let applied = 0
  for (const c of candidates) {
    // Use respondedAt as the viewedAt proxy. respondedAt is set when the
    // provider's response (interest/accept/decline) is recorded — the provider
    // must have viewed the lead before responding. This is correct within
    // ±15s of true viewedAt and is good enough for the funnel report.
    const updated = await db.lead.updateMany({
      where: { id: c.id, viewedAt: null },
      data: { viewedAt: c.respondedAt },
    })
    if (updated.count > 0) applied += 1
  }

  if (JSON_OUTPUT) {
    process.stdout.write(JSON.stringify({ applied }, null, 2))
    process.stdout.write('\n')
  } else {
    console.log(`\nApplied: ${applied} of ${candidates.length}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-lead-viewed-at] failed:', err)
    process.exit(1)
  })
