/**
 * Read-only matchability audit (PJ-01c, platform audit 2026-07-06).
 *
 * Lists approved + active providers that fail one or more matchability
 * readiness gates (lib/matching/readiness.ts) — i.e. providers that passed
 * onboarding but will silently never receive leads — grouped by reason code.
 *
 * Usage:
 *   pnpm exec tsx scripts/audit-provider-matchability.ts
 *   pnpm exec tsx scripts/audit-provider-matchability.ts --include-test-users
 *
 * This script performs NO writes.
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { getProviderMatchabilityReadiness } from '../lib/matching/readiness'

async function main() {
  const includeTestUsers = process.argv.includes('--include-test-users')

  console.log('--- audit-provider-matchability (READ-ONLY) ---')

  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      ...(includeTestUsers ? {} : { isTestUser: false }),
    },
    select: { id: true, name: true, phone: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`scanning ${providers.length} active+verified providers${includeTestUsers ? ' (incl. test users)' : ''}\n`)

  const byReason = new Map<string, Array<{ id: string; name: string; phone: string }>>()
  let matchable = 0
  let unmatchable = 0

  for (const provider of providers) {
    const readiness = await getProviderMatchabilityReadiness(provider.id)
    if (!readiness.providerFound) continue
    if (readiness.matchable) {
      matchable += 1
      continue
    }
    unmatchable += 1
    const masked = `…${provider.phone.slice(-4)}`
    console.log(
      `✗ ${provider.id}  ${provider.name.padEnd(28)} ${masked}  → ${readiness.failReasonCodes.join(', ')}`,
    )
    for (const code of readiness.failReasonCodes) {
      const list = byReason.get(code) ?? []
      list.push({ id: provider.id, name: provider.name, phone: masked })
      byReason.set(code, list)
    }
  }

  console.log('\n=== summary ===')
  console.log(`matchable:   ${matchable}`)
  console.log(`unmatchable: ${unmatchable}`)
  console.log('\nby reason:')
  const sorted = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [code, list] of sorted) {
    console.log(`  ${code.padEnd(28)} ${list.length}`)
  }

  if (byReason.has('ACTIVE_SERVICE_AREA')) {
    console.log(
      '\nHint: providers failing ACTIVE_SERVICE_AREA can be repaired with\n' +
        '  pnpm exec tsx scripts/backfill-provider-service-areas.ts   (dry-run)\n' +
        '  pnpm exec tsx scripts/backfill-provider-service-areas.ts --execute',
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
