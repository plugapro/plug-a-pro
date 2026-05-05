// Sync DB test flags with the bootstrap phone list. The DB flags are the
// authoritative source of truth at runtime; this script ensures the static
// INTERNAL_TEST_PHONE_NUMBERS list is reflected on every existing
// Customer/Provider row, and reports any inconsistencies for review.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/backfill-test-user-flags.ts [--dry-run]

import { PrismaClient } from '@prisma/client'
import {
  INTERNAL_TEST_COHORT_NAME,
  INTERNAL_TEST_PHONE_NUMBERS,
} from '../lib/internal-test-cohort'
import { phoneLookupVariants } from '../lib/whatsapp-identity'

const db = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const phoneVariants = INTERNAL_TEST_PHONE_NUMBERS.flatMap((p) => phoneLookupVariants(p))

  console.log(`Bootstrap list contains ${INTERNAL_TEST_PHONE_NUMBERS.length} phone(s).`)

  // ── Customers ────────────────────────────────────────────────────────────
  const customers = await db.customer.findMany({
    where: { phone: { in: phoneVariants } },
    select: { id: true, phone: true, isTestUser: true, cohortName: true },
  })

  const customersToFix = customers.filter(
    (c) => !c.isTestUser || c.cohortName !== INTERNAL_TEST_COHORT_NAME,
  )

  console.log(`Customers matching list: ${customers.length} (${customersToFix.length} need update)`)
  for (const c of customersToFix) {
    console.log(`  customer=${c.id} phone=${c.phone} isTestUser=${c.isTestUser} cohort=${c.cohortName}`)
  }

  // ── Providers ────────────────────────────────────────────────────────────
  const providers = await db.provider.findMany({
    where: { phone: { in: phoneVariants } },
    select: { id: true, phone: true, isTestUser: true, cohortName: true },
  })

  const providersToFix = providers.filter(
    (p) => !p.isTestUser || p.cohortName !== INTERNAL_TEST_COHORT_NAME,
  )

  console.log(`Providers matching list: ${providers.length} (${providersToFix.length} need update)`)
  for (const p of providersToFix) {
    console.log(`  provider=${p.id} phone=${p.phone} isTestUser=${p.isTestUser} cohort=${p.cohortName}`)
  }

  // ── Inconsistency report (DB says test but phone not in list) ────────────
  const orphanCustomers = await db.customer.findMany({
    where: {
      isTestUser: true,
      phone: { notIn: phoneVariants },
    },
    select: { id: true, phone: true, name: true },
  })
  const orphanProviders = await db.provider.findMany({
    where: {
      isTestUser: true,
      phone: { notIn: phoneVariants },
    },
    select: { id: true, phone: true, name: true },
  })
  if (orphanCustomers.length || orphanProviders.length) {
    console.log('')
    console.log('Heads up — DB-flagged test users with phones outside the bootstrap list:')
    for (const c of orphanCustomers) {
      console.log(`  customer=${c.id} phone=${c.phone} name=${c.name}`)
    }
    for (const p of orphanProviders) {
      console.log(`  provider=${p.id} phone=${p.phone} name=${p.name}`)
    }
    console.log('  These are kept as-is. The DB flag remains authoritative.')
  }

  if (dryRun) {
    console.log('')
    console.log('Dry run — no updates applied. Re-run without --dry-run to fix.')
    await db.$disconnect()
    return
  }

  let updatedCustomers = 0
  for (const c of customersToFix) {
    await db.customer.update({
      where: { id: c.id },
      data: { isTestUser: true, cohortName: INTERNAL_TEST_COHORT_NAME },
    })
    updatedCustomers++
  }

  let updatedProviders = 0
  for (const p of providersToFix) {
    await db.provider.update({
      where: { id: p.id },
      data: { isTestUser: true, cohortName: INTERNAL_TEST_COHORT_NAME },
    })
    updatedProviders++
  }

  console.log('')
  console.log(`Updated ${updatedCustomers} customer(s) and ${updatedProviders} provider(s).`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
