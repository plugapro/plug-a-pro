// ─── Cleanup script: clear legacy or accidental matching backlog ─────────────
// Use this when legacy requests were created with OPS_REVIEW and are blocking
// fresh auto-match verification.
//
// Safety:
// - Defaults to DRY-RUN. Pass --confirm to actually delete.
// - Refuses common production-looking DATABASE_URL hostnames unless
//   --i-know-what-im-doing is provided.
//
// Usage:
//   npx tsx scripts/cleanup-ops-review-backlog.ts
//   npx tsx scripts/cleanup-ops-review-backlog.ts --confirm
//   npx tsx scripts/cleanup-ops-review-backlog.ts --confirm --status=PENDING_VALIDATION,OPEN
//   npx tsx scripts/cleanup-ops-review-backlog.ts --confirm --all-modes
//   npx tsx scripts/cleanup-ops-review-backlog.ts --confirm --test-only

import { db } from '../lib/db'

type Counts = Record<string, number>

const args = new Set(process.argv.slice(2))
const CONFIRM = args.has('--confirm')
const TEST_ONLY = args.has('--test-only')
const FORCE_PROD = args.has('--i-know-what-im-doing')
const ALL_MODES = args.has('--all-modes')
const STATUS_ARG = [...args].find((arg) => arg.startsWith('--status='))?.split('=')[1] ?? ''

const statusList = (STATUS_ARG.length
  ? STATUS_ARG.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : ['PENDING_VALIDATION', 'OPEN', 'MATCHING'])

const validStatuses = new Set([
  'PENDING_VALIDATION',
  'OPEN',
  'MATCHING',
  'SHORTLIST_READY',
  'PROVIDER_CONFIRMATION_PENDING',
  'MATCHED',
  'EXPIRED',
  'CANCELLED',
])

for (const status of statusList) {
  if (!validStatuses.has(status)) {
    throw new Error(`Unsupported status "${status}" in --status argument`)
  }
}

const whereCommon: Record<string, unknown> = {
  status: { in: statusList },
  // Most legacy/stalled auto-match blockers are still unaccepted, so keep this
  // guard to avoid touching jobs that already created a match.
  match: null,
}

if (!ALL_MODES) {
  whereCommon.assignmentMode = 'OPS_REVIEW'
}

if (TEST_ONLY) {
  whereCommon.isTestRequest = true
}

function databaseUrlHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function refuseIfProductionHost() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    console.error('DATABASE_URL is not set — refusing to run.')
    process.exit(1)
  }

  // Primary guard (finding 817d8454): compare the DATABASE_URL hostname against an
  // explicit, configurable PRODUCTION_DB_HOST. Supabase pooled production URLs do
  // not contain "prod"/"live" substrings, so the substring heuristic below is not
  // sufficient on its own. Setting PRODUCTION_DB_HOST in the production environment
  // makes this script refuse to run there even with --i-know-what-im-doing.
  const productionHost = process.env.PRODUCTION_DB_HOST?.trim().toLowerCase()
  const currentHost = databaseUrlHostname(url)
  if (productionHost && currentHost && currentHost === productionHost) {
    console.error(
      `DATABASE_URL host "${currentHost}" matches PRODUCTION_DB_HOST. Refusing to run — this is a hard block.`,
    )
    process.exit(2)
  }

  if (FORCE_PROD) return

  // Secondary best-effort heuristic for environments where PRODUCTION_DB_HOST is
  // not configured.
  const lowered = url.toLowerCase()
  const productionHints = ['prod', 'production', 'live', 'app.plugapro']
  if (productionHints.some((hint) => lowered.includes(hint))) {
    console.error('DATABASE_URL looks like a production target. Refusing to run.')
    console.error('If this is intentional, re-run with --i-know-what-im-doing.')
    process.exit(2)
  }
}

async function main() {
  refuseIfProductionHost()

  const candidates = await db.jobRequest.findMany({
    where: whereCommon as NonNullable<Parameters<typeof db.jobRequest.findMany>[0]>['where'],
    select: {
      id: true,
      status: true,
      assignmentMode: true,
      source: true,
      createdAt: true,
      isTestRequest: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      _count: {
        select: {
          leads: true,
          matchAttempts: true,
          assignmentHolds: true,
          dispatchDecisions: true,
          attachments: true,
          // ProviderShortlist is modelled via ProviderShortlist/ProviderShortlistItem
          // in current schema; querying `shortlists` directly may fail in older DB
          // snapshots where the FK path differs. Keep count conservative here.
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log('──────────────────────────────────────────────')
  console.log('Legacy matching backlog cleanup')
  console.log('Database:', process.env.DATABASE_URL?.split('@').at(-1) ?? '(unknown)')
  console.log('Filter:')
  console.log(`  statuses: ${statusList.join(', ')}`)
  console.log(`  assignmentMode: ${ALL_MODES ? 'all modes' : 'OPS_REVIEW (default)'}`)
  console.log(`  test-only: ${TEST_ONLY ? 'yes' : 'no'}`)
  console.log(`  exclude matched: yes`)
  console.log('Mode:', CONFIRM ? 'CONFIRM (delete)' : 'DRY RUN')
  console.log(`Found ${candidates.length} job request(s).`)
  console.log('──────────────────────────────────────────────')

  const counts: Counts = {
    candidates: candidates.length,
    leads: 0,
    matchAttempts: 0,
    assignmentHolds: 0,
    dispatchDecisions: 0,
    attachments: 0,
  }

  for (const jr of candidates) {
    counts.leads += jr._count.leads
    counts.matchAttempts += jr._count.matchAttempts
    counts.assignmentHolds += jr._count.assignmentHolds
    counts.dispatchDecisions += jr._count.dispatchDecisions
    counts.attachments += jr._count.attachments
  }

  if (counts.candidates === 0) {
    console.log('Nothing to delete.')
    await db.$disconnect()
    return
  }

  console.log('Sample IDs:')
  for (const jr of candidates.slice(0, 20)) {
    console.log(`  ${jr.id} | ${jr.status} ${jr.assignmentMode} ${jr.source ?? ''} ${jr.isTestRequest ? '[test]' : ''}`)
  }

  console.log('Estimated row impact:')
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(18)} ${v}`)
  }

  if (!CONFIRM) {
    console.log('\nDry run complete. Re-run with --confirm to delete.')
    await db.$disconnect()
    return
  }

  const ids = candidates.map((jr) => jr.id)

  // SECURITY (finding 817d8454): re-apply the FULL selection predicate (status,
  // assignmentMode, match:null, test-only) in the same transaction as the delete,
  // not just the previously collected IDs. A record can change between selection
  // and deletion (e.g. a match is created, status advances); restricting the
  // DELETE to `id IN (ids) AND <whereCommon>` ensures we never delete a row that
  // no longer satisfies the original filter.
  const result = await db.$transaction(async (tx) => {
    return tx.jobRequest.deleteMany({
      where: {
        AND: [
          { id: { in: ids } },
          whereCommon as NonNullable<Parameters<typeof tx.jobRequest.deleteMany>[0]>['where'],
        ],
      } as NonNullable<Parameters<typeof tx.jobRequest.deleteMany>[0]>['where'],
    })
  })

  console.log(`\nDeleted ${result.count} job requests.`)
  if (result.count !== ids.length) {
    console.log(
      `Note: ${ids.length - result.count} candidate(s) no longer matched the filter at delete time and were skipped.`,
    )
  }
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect()
  process.exit(1)
})
