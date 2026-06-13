import { db } from '../db'
import { isEnabled } from '../flags'
import {
  debitPaidCreditsForKycFeeInTransaction,
  ProviderWalletError,
} from '../provider-wallet'
import { PROVIDER_CREDIT_PRICE_CENTS } from '../provider-credit-pricing'
import { formatRandsFromCents, kycFeeRecoveredKey } from './constants'
import { getKycFeeStatus, writeKycFeeLedgerEntryInTransaction } from './ledger'

export type KycFeeRecoveryResult =
  | { outcome: 'FLAG_OFF' | 'NO_OUTSTANDING_FEE' | 'ALREADY_RECOVERED' }
  | { outcome: 'SKIPPED_LEGACY_AMOUNT'; outstandingCents: number }
  | {
      outcome: 'RECOVERED'
      creditsDeducted: number
      amountCents: number
      walletLedgerEntryId: string
      feeLedgerEntryId: string
    }
  | { outcome: 'FAILED'; reason: string }

/**
 * Settles a provider's outstanding once-off KYC fee by deducting whole PAID
 * credits, called after a top-up credit has COMMITTED. Runs in its own
 * transaction so a recovery failure can never roll back the top-up credit —
 * the debt simply stays outstanding for the next top-up.
 *
 * Never throws: every caller is a post-commit hook (webhook handler, admin
 * action) where a recovery error must not fail the surrounding request.
 */
// Only the recovery idempotency key counts as "already recovered". Any other
// unique violation inside the transaction is a real failure that must alert,
// not be silently absorbed.
function isIdempotencyKeyCollision(error: unknown): boolean {
  if ((error as { code?: string }).code !== 'P2002') return false
  const target = (error as { meta?: { target?: unknown } }).meta?.target
  const targetText = Array.isArray(target) ? target.join(',') : String(target ?? '')
  return targetText.includes('idempotencyKey')
}

export async function settleOutstandingKycFeeAfterTopUp(input: {
  providerId: string
  paymentIntentId: string
  createdBy: string
}): Promise<KycFeeRecoveryResult> {
  try {
    if (!(await isEnabled('kyc.fee_accrual.enabled'))) {
      return { outcome: 'FLAG_OFF' }
    }

    // Pre-transaction guard: the steady-state majority of top-ups (fee already
    // settled or never accrued) must not pay for an interactive transaction.
    // The in-transaction re-read below stays authoritative for correctness.
    const preStatus = await getKycFeeStatus(input.providerId)
    if (preStatus.outstandingCents <= 0) {
      return { outcome: 'NO_OUTSTANDING_FEE' }
    }

    return await db.$transaction(async (tx) => {
      const status = await getKycFeeStatus(input.providerId, tx)

      if (status.outstandingCents <= 0) {
        return { outcome: 'NO_OUTSTANDING_FEE' } as const
      }

      if (status.outstandingCents % PROVIDER_CREDIT_PRICE_CENTS !== 0) {
        // Pre-R50 accruals (e.g. legacy R20 rows) don't map to whole credits.
        // Leave them for admin resolution rather than over- or under-charging.
        console.warn('[kyc-fee-recovery] outstanding fee is not a whole-credit multiple; skipping', {
          alert: true,
          providerId: input.providerId,
          paymentIntentId: input.paymentIntentId,
          outstandingCents: status.outstandingCents,
        })
        return {
          outcome: 'SKIPPED_LEGACY_AMOUNT',
          outstandingCents: status.outstandingCents,
        } as const
      }

      const creditsToDeduct = status.outstandingCents / PROVIDER_CREDIT_PRICE_CENTS

      const walletResult = await debitPaidCreditsForKycFeeInTransaction(
        tx,
        input.providerId,
        creditsToDeduct,
        {
          referenceType: 'payment_intent',
          referenceId: input.paymentIntentId,
          description: `Once-off ID verification fee (${formatRandsFromCents(status.outstandingCents)}) settled from first top-up`,
          metadata: { outstandingCents: status.outstandingCents },
          createdBy: input.createdBy,
        },
      )

      const walletLedgerEntryId = walletResult.ledgerEntries[0].id

      const feeEntry = await writeKycFeeLedgerEntryInTransaction(tx, {
        providerId: input.providerId,
        reason: 'KYC_FEE_RECOVERED',
        amountCents: status.outstandingCents,
        referenceType: 'payment_intent',
        referenceId: input.paymentIntentId,
        description: `Recovered from first top-up (${creditsToDeduct} credit${creditsToDeduct === 1 ? '' : 's'})`,
        idempotencyKey: kycFeeRecoveredKey(input.providerId),
        source: 'system',
        createdBy: input.createdBy,
        metadata: { creditsDeducted: creditsToDeduct, walletLedgerEntryId },
      })

      return {
        outcome: 'RECOVERED',
        creditsDeducted: creditsToDeduct,
        amountCents: status.outstandingCents,
        walletLedgerEntryId,
        feeLedgerEntryId: feeEntry.id,
      } as const
    })
  } catch (error) {
    if (isIdempotencyKeyCollision(error)) {
      // Another top-up settled the fee concurrently; unique idempotency key
      // rolled this transaction back, so the wallet debit never committed.
      return { outcome: 'ALREADY_RECOVERED' }
    }

    const reason =
      error instanceof ProviderWalletError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error)

    console.error('[kyc-fee-recovery] failed to settle outstanding KYC fee; debt remains', {
      alert: true,
      providerId: input.providerId,
      paymentIntentId: input.paymentIntentId,
      error,
    })

    return { outcome: 'FAILED', reason }
  }
}
