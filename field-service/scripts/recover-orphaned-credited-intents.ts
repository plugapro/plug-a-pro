/**
 * Recovery script: orphaned CREDITED payment intents.
 *
 * An orphaned CREDITED intent has status=CREDITED but no creditedLedgerEntryId.
 * This means the intent was marked as paid (gateway/ITN path) but the wallet
 * credit transaction failed, so the provider was never given their credits.
 *
 * Usage:
 *   pnpm tsx scripts/recover-orphaned-credited-intents.ts
 *   pnpm tsx scripts/recover-orphaned-credited-intents.ts --apply
 *
 * Without --apply: dry run — prints affected intents without making changes.
 * With --apply: creates ledger entries, increments wallet balances, sends notifications.
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { creditPaidCreditsInTransaction, ProviderWalletError } from '../lib/provider-wallet'
import { notifyProviderPaymentCredited } from '../lib/provider-wallet-notifications'

const IS_APPLY = process.argv.includes('--apply')

async function findOrphanedIntents() {
  return db.paymentIntent.findMany({
    where: {
      status: 'CREDITED',
      creditedLedgerEntryId: null,
    },
    include: {
      provider: {
        select: { id: true, name: true, phone: true, isTestUser: true, cohortName: true },
      },
    },
    orderBy: { creditedAt: 'asc' },
  })
}

async function recoverIntent(intent: Awaited<ReturnType<typeof findOrphanedIntents>>[number]) {
  const result = await db.$transaction(async (tx) => {
    // Re-check inside the transaction: skip if another call already recovered this intent.
    const current = await tx.paymentIntent.findUnique({
      where: { id: intent.id },
      select: { creditedLedgerEntryId: true },
    })
    if (current?.creditedLedgerEntryId) {
      return { skipped: true as const }
    }

    const walletResult = await creditPaidCreditsInTransaction(
      tx,
      intent.providerId,
      intent.creditsToIssue,
      {
        referenceType: 'payment_intent',
        referenceId: intent.id,
        description: `Recovery credit: ${intent.paymentMethod} ${intent.paymentReference}`,
        metadata: {
          paymentReference: intent.paymentReference,
          amountCents: intent.amountCents,
          creditsToIssue: intent.creditsToIssue,
          recoveredAt: new Date().toISOString(),
        },
        createdBy: 'system-recovery',
        isTestTransaction: intent.provider.isTestUser,
        cohortName: intent.provider.cohortName,
      },
    )

    const ledgerEntry = walletResult.ledgerEntries[0]

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { creditedLedgerEntryId: ledgerEntry.id },
    })

    return { skipped: false as const, ledgerEntryId: ledgerEntry.id }
  })

  if (!result.skipped) {
    // Post-commit KYC fee settlement, same as the live crediting paths.
    const { settleOutstandingKycFeeAfterTopUp } = await import('../lib/kyc-fee/recovery')
    const settlement = await settleOutstandingKycFeeAfterTopUp({
      providerId: intent.providerId,
      paymentIntentId: intent.id,
      createdBy: 'system-recovery',
    })
    if (settlement.outcome !== 'NO_OUTSTANDING_FEE' && settlement.outcome !== 'FLAG_OFF') {
      console.log(`  KYC fee settlement: ${settlement.outcome}`)
    }
  }

  return result
}

async function main() {
  console.log(`\n[recover-orphaned-intents] mode=${IS_APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  const orphaned = await findOrphanedIntents()

  if (orphaned.length === 0) {
    console.log('No orphaned CREDITED intents found. Nothing to do.')
    return
  }

  console.log(`Found ${orphaned.length} orphaned CREDITED intent(s):\n`)
  for (const intent of orphaned) {
    console.log(
      `  id=${intent.id}  ref=${intent.paymentReference}  method=${intent.paymentMethod}` +
      `  credits=${intent.creditsToIssue}  provider=${intent.provider.name ?? intent.providerId}` +
      `  creditedAt=${intent.creditedAt?.toISOString() ?? 'null'}`,
    )
  }

  if (!IS_APPLY) {
    console.log('\nDry run complete. Run with --apply to recover these intents.')
    return
  }

  console.log('\nApplying recovery...\n')
  let recovered = 0
  let skipped = 0
  let failed = 0

  for (const intent of orphaned) {
    if (!Number.isInteger(intent.creditsToIssue) || intent.creditsToIssue <= 0) {
      console.error(`  ${intent.id} ... SKIPPED (invalid creditsToIssue=${intent.creditsToIssue}) — manual review required`)
      failed++
      continue
    }
    process.stdout.write(`  ${intent.id} ... `)
    try {
      const result = await recoverIntent(intent)
      if (result.skipped) {
        console.log('skipped (already recovered concurrently)')
        skipped++
        continue
      }
      console.log(`recovered — ledger entry ${result.ledgerEntryId}`)
      recovered++

      // Non-blocking notification — failure must not roll back the recovery.
      notifyProviderPaymentCredited(intent.id).catch((err: unknown) => {
        console.error(`  [notify] failed for ${intent.id}:`, err instanceof Error ? err.message : err)
      })
    } catch (err) {
      if (err instanceof ProviderWalletError && err.code === 'WALLET_NOT_ACTIVE') {
        console.error(`FAILED (WALLET_NOT_ACTIVE) — reactivate wallet for provider ${intent.providerId} then re-run`)
      } else {
        console.error(`FAILED — ${err instanceof Error ? err.message : String(err)}`)
      }
      failed++
    }
  }

  console.log(`\nSummary: recovered=${recovered}  skipped=${skipped}  failed=${failed}`)
  if (failed > 0) {
    console.error('Some intents failed to recover. Check logs above and retry.')
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error('[recover-orphaned-intents] fatal:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
