/**
 * Sweeps providers with kycStatus VERIFIED that have no KYC fee accrual and
 * books the fee through the same accrue-or-sponsor path as the live hook.
 *
 * Dry-run by default. Usage:
 *   pnpm tsx scripts/reconcile-kyc-fees.ts             # report only
 *   pnpm tsx scripts/reconcile-kyc-fees.ts --apply     # book missing fees
 *
 * NOTE: running with --apply against providers verified BEFORE the fee model
 * launched is a product decision (retroactive fees). Confirm before applying.
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { bookKycFeeForVerifiedProvider } from '../lib/kyc-fee/booking'

const apply = process.argv.includes('--apply')

async function main() {
  const providers = await db.provider.findMany({
    where: {
      kycStatus: 'VERIFIED',
      kycFeeLedgerEntries: { none: { reason: 'KYC_FEE_ACCRUED' } },
    },
    select: {
      id: true,
      name: true,
      identityVerifications: {
        where: { status: 'PASSED', decision: 'PASS' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  })

  console.log(`${providers.length} VERIFIED provider(s) without a KYC fee accrual.`)
  if (apply) {
    for (const p of providers) {
      const verificationId = p.identityVerifications[0]?.id
      if (!verificationId) {
        console.log(`  skip ${p.id} (${p.name}): no PASSED verification row`)
        continue
      }
      const result = await bookKycFeeForVerifiedProvider({ providerId: p.id, verificationId })
      console.log(`  ${p.id} (${p.name}): ${result.outcome}`)
    }
  } else {
    for (const p of providers) console.log(`  would book: ${p.id} (${p.name})`)
  }

  await sweepMissedRecoveries()

  if (!apply) console.log('\nDry run. Re-run with --apply to book/settle.')
}

/**
 * Safety net for missed first-top-up recoveries: a provider whose fee is
 * still outstanding but who already has a CREDITED top-up should have been
 * settled by the post-credit hook. Catches hook gaps (a crediting path that
 * forgot to call settlement) and transient settlement failures for providers
 * who never topped up again.
 */
async function sweepMissedRecoveries() {
  const accrued = await db.provider.findMany({
    where: { kycFeeLedgerEntries: { some: { reason: 'KYC_FEE_ACCRUED' } } },
    select: {
      id: true,
      name: true,
      paymentIntents: {
        where: { status: 'CREDITED' },
        orderBy: { creditedAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  })

  const { getKycFeeStatus } = await import('../lib/kyc-fee/ledger')
  const candidates: Array<{ id: string; name: string; intentId: string }> = []
  for (const p of accrued) {
    const intentId = p.paymentIntents[0]?.id
    if (!intentId) continue
    const status = await getKycFeeStatus(p.id)
    if (status.outstandingCents > 0) candidates.push({ id: p.id, name: p.name, intentId })
  }

  console.log(`\n${candidates.length} provider(s) with an outstanding fee despite a CREDITED top-up.`)
  if (!apply) {
    for (const c of candidates) console.log(`  would settle: ${c.id} (${c.name}) via intent ${c.intentId}`)
    return
  }

  const { settleOutstandingKycFeeAfterTopUp } = await import('../lib/kyc-fee/recovery')
  for (const c of candidates) {
    const result = await settleOutstandingKycFeeAfterTopUp({
      providerId: c.id,
      paymentIntentId: c.intentId,
      createdBy: 'reconcile-kyc-fees',
    })
    console.log(`  ${c.id} (${c.name}): ${result.outcome}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
