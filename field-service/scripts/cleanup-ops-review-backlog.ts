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

function refuseIfProductionHost() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    console.error('DATABASE_URL is not set — refusing to run.')
    process.exit(1)
  }
  if (FORCE_PROD) return
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
          shortlists: true,
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
    shortlists: 0,
  }

  for (const jr of candidates) {
    counts.leads += jr._count.leads
    counts.matchAttempts += jr._count.matchAttempts
    counts.assignmentHolds += jr._count.assignmentHolds
    counts.dispatchDecisions += jr._count.dispatchDecisions
    counts.attachments += jr._count.attachments
    counts.shortlists += jr._count.shortlists
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
  const result = await db.jobRequest.deleteMany({
    where: { id: { in: ids } },
  })

  console.log(`\nDeleted ${result.count} job requests.`)
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect()
  process.exit(1)
})
