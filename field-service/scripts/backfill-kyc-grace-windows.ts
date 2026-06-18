/**
 * backfill-kyc-grace-windows.ts
 *
 * Stamps Provider.kycGraceUntil on every legacy provider so the new mandatory
 * KYC gate (provider.kyc.required_for_activation) does not block re-activation
 * during the grace period.
 *
 * Sets kycGraceUntil = createdAt + KYC_EXISTING_PROVIDER_GRACE_DAYS (env or 30
 * by default) for every provider where:
 *   - createdAt < KYC_GRACE_CUTOFF (legacy cohort only)
 *   - kycStatus != 'VERIFIED' (already-verified providers don't need grace)
 *   - kycGraceUntil IS NULL (idempotent — never overwrites)
 *
 * Post-cutoff providers are NEVER given grace by this script — they must verify
 * before activation, period. Already-verified providers don't need grace.
 *
 * Safe to run multiple times. Dry-run by default — prints counts only. Pass
 * --apply to actually write.
 *
 * Usage:
 *   npx tsx scripts/backfill-kyc-grace-windows.ts            # dry run
 *   npx tsx scripts/backfill-kyc-grace-windows.ts --apply    # write
 *
 * Requires:
 *   DATABASE_URL  (load .env.local with set -a; source .env.local; set +a)
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { KYC_GRACE_CUTOFF } from '../lib/matching/kyc-grace'

const GRACE_DAYS = Number.parseInt(process.env.KYC_EXISTING_PROVIDER_GRACE_DAYS ?? '30', 10)
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log('─'.repeat(72))
  console.log('KYC grace-window backfill')
  console.log(`  cutoff:      ${KYC_GRACE_CUTOFF.toISOString()}`)
  console.log(`  grace days:  ${GRACE_DAYS}`)
  console.log(`  mode:        ${APPLY ? 'APPLY (writes will occur)' : 'DRY-RUN (no writes)'}`)
  console.log('─'.repeat(72))

  // Read every legacy provider that hasn't been backfilled yet.
  const candidates = await db.provider.findMany({
    where: {
      createdAt: { lt: KYC_GRACE_CUTOFF },
      kycStatus: { not: 'VERIFIED' },
      kycGraceUntil: null,
    },
    select: {
      id: true,
      phone: true,
      name: true,
      createdAt: true,
      kycStatus: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\nCandidates (legacy, non-VERIFIED, ungraced): ${candidates.length}`)

  if (candidates.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const dayMs = 24 * 60 * 60 * 1000
  let updated = 0
  let alreadyExpired = 0

  for (const provider of candidates) {
    const graceUntil = new Date(provider.createdAt.getTime() + GRACE_DAYS * dayMs)
    const isAlreadyExpired = graceUntil <= new Date()
    if (isAlreadyExpired) alreadyExpired += 1

    if (APPLY) {
      await db.provider.update({
        where: { id: provider.id },
        data: { kycGraceUntil: graceUntil },
      })
      updated += 1
    }

    const phoneMask = provider.phone ? `…${provider.phone.slice(-4)}` : '(no-phone)'
    console.log(
      `  ${APPLY ? '✓' : '·'} ${provider.id} (${phoneMask}) created=${provider.createdAt.toISOString().slice(0, 10)} grace_until=${graceUntil.toISOString().slice(0, 10)}${isAlreadyExpired ? '  ⚠ already expired' : ''}`,
    )
  }

  console.log('─'.repeat(72))
  console.log(`Summary: ${APPLY ? 'updated' : 'would update'} ${candidates.length} provider rows`)
  if (alreadyExpired > 0) {
    console.log(
      `⚠  ${alreadyExpired} of those have a grace window in the past (createdAt + ${GRACE_DAYS}d already elapsed) — those providers will be BLOCKED from re-activation by the new gate the moment provider.kyc.required_for_activation flips ON.`,
    )
    console.log(
      `   Consider raising KYC_EXISTING_PROVIDER_GRACE_DAYS for the apply run, or running the kyc-drive nudge cron first to chase those providers into VERIFIED.`,
    )
  }
  console.log(APPLY ? 'Done.' : 'Dry-run complete. Re-run with --apply to write.')
}

main()
  .catch((err) => {
    console.error('backfill-kyc-grace-windows failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
