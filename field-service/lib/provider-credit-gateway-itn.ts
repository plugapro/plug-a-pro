/**
 * Gateway ITN crediting service.
 *
 * Called exclusively by the Payfast ITN webhook handler after a payment
 * notification has been fully verified (source IP + signature + COMPLETE
 * status + amount match). This module must NOT be exposed as a public API
 * route or server action.
 *
 * Responsibilities:
 *   - Idempotent crediting of a provider wallet from a verified ITN
 *   - Atomic transaction: intent → CREDITED, wallet balance increment, ledger entry
 *   - Post-credit events: WhatsApp notification (outside transaction)
 *
 * Invariants:
 *   - One intent → at most one credit, regardless of how many times this
 *     function is called for the same intentId.
 *   - Wallet balance never decreases from this function (credits only).
 */

import { db } from './db'
import { creditPaidCreditsInTransaction, PLUG_A_PRO_CREDIT_VALUE_CENTS } from './provider-wallet'

/**
 * Credits that the paid amount is worth at CURRENT pricing. A PaymentIntent
 * persists creditsToIssue at creation time; if the credit price changed after a
 * pending checkout was created, the stored value can be stale (e.g. an old R100
 * intent stored 5 credits when R100 now buys 2). We never issue MORE than the
 * amount is currently worth, so we credit the lower of stored vs recomputed.
 */
function creditsToIssueForAmount(amountCents: number, storedCreditsToIssue: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0
  const recomputed = Math.floor(amountCents / PLUG_A_PRO_CREDIT_VALUE_CENTS)
  return Math.max(0, Math.min(storedCreditsToIssue, recomputed))
}

// Gateway intents arrive at ITN_RECEIVED before crediting. This function
// accepts both ITN_RECEIVED (normal flow) and PENDING_PAYMENT (admin retry
// or missed-ITN recovery path) as creditable statuses.
// CANCELLED is included so a provider who self-cancels a link but still pays
// it at a till is credited rather than relying on manual recovery.
const GATEWAY_CREDITABLE_STATUSES = ['PENDING_PAYMENT', 'ITN_RECEIVED', 'CANCELLED'] as const

type CreditFromItnResult =
  | { credited: true; ledgerEntryId: string }
  | { credited: false; reason: string }

type GatewayCreditSource = {
  gatewayLabel: 'Payfast' | 'Pay@'
  createdBy: 'payfast-itn' | 'payat-webhook'
}

/**
 * Credit a provider's wallet from a verified Payfast ITN.
 *
 * Returns `{ credited: true }` on success or `{ credited: false, reason }`
 * when the intent is not found, already credited or in a non-creditable state.
 * Never throws - callers (the ITN handler) log failures and return HTTP 200.
 */
async function creditProviderWalletFromGatewayIntent(
  intentId: string,
  source: GatewayCreditSource,
): Promise<CreditFromItnResult> {
  // Pre-transaction idempotency guard - avoids opening a transaction for
  // the common case where the intent is already credited.
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      providerId: true,
      amountCents: true,
      creditsToIssue: true,
      paymentReference: true,
      status: true,
      creditedAt: true,
      itnPaymentStatus: true,
      provider: { select: { isTestUser: true, cohortName: true } },
    },
  })

  if (!intent) {
    return { credited: false, reason: 'intent not found' }
  }

  if (intent.status === 'CREDITED' || intent.creditedAt) {
    return { credited: false, reason: 'already credited' }
  }

  if (!GATEWAY_CREDITABLE_STATUSES.includes(intent.status as (typeof GATEWAY_CREDITABLE_STATUSES)[number])) {
    return { credited: false, reason: `intent status ${intent.status} is not creditable` }
  }

  let ledgerEntryId: string

  try {
    const result = await db.$transaction(async (tx) => {
      // Re-check inside the transaction for concurrent-call safety.
      // updateMany with a status predicate on the intent acts as an
      // optimistic lock: if another request already flipped the status to
      // CREDITED, count === 0 and we roll back.
      const locked = await tx.paymentIntent.updateMany({
        where: {
          id: intent.id,
          status: { in: [...GATEWAY_CREDITABLE_STATUSES] },
          creditedAt: null,
        },
        data: { status: 'CREDITED', creditedAt: new Date() },
      })

      if (locked.count !== 1) {
        throw new AlreadyCreditedError()
      }

      const amountFormatted = formatZar(intent.amountCents)
      // Recompute credits against current pricing. A pre-price-change intent may
      // carry a stale (higher) creditsToIssue for its amount; we issue the lower
      // of stored vs recomputed so an old cheap checkout cannot over-credit.
      const creditsToIssue = creditsToIssueForAmount(intent.amountCents, intent.creditsToIssue)
      if (creditsToIssue !== intent.creditsToIssue) {
        console.warn('[provider-credit-gateway-itn] stale creditsToIssue recomputed against current pricing', {
          alert: true,
          intentId: intent.id,
          providerId: intent.providerId,
          amountCents: intent.amountCents,
          storedCreditsToIssue: intent.creditsToIssue,
          issuedCreditsToIssue: creditsToIssue,
        })
      }
      const walletResult = await creditPaidCreditsInTransaction(
        tx,
        intent.providerId,
        creditsToIssue,
        {
          referenceType: 'payment_intent',
          referenceId: intent.id,
          description: `Top-up via ${source.gatewayLabel} - ${creditsToIssue} Plug A Pro provider credits (${amountFormatted})`,
          metadata: {
            paymentReference: intent.paymentReference,
            amountCents: intent.amountCents,
            creditsToIssue,
            storedCreditsToIssue: intent.creditsToIssue,
            itnPaymentStatus: intent.itnPaymentStatus,
          },
          createdBy: source.createdBy,
          isTestTransaction: intent.provider.isTestUser,
          cohortName: intent.provider.cohortName,
        },
      )

      const ledgerEntry = walletResult.ledgerEntries[0]

      // Link the ledger entry back to the intent for audit trail.
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { creditedLedgerEntryId: ledgerEntry.id },
      })

      return { ledgerEntryId: ledgerEntry.id }
    })

    ledgerEntryId = result.ledgerEntryId
  } catch (error) {
    if (error instanceof AlreadyCreditedError) {
      return { credited: false, reason: 'already credited (concurrent call)' }
    }
    // Re-throw so the ITN handler can log the stack and return 200 to Payfast.
    throw error
  }

  // Post-transaction notifications - failures must not roll back the credit.
  const { notifyProviderPaymentCredited } = await import('./provider-wallet-notifications')
  notifyProviderPaymentCredited(intentId).catch((error: unknown) => {
    console.error('[provider-credit-gateway-itn] WhatsApp credit notification failed', {
      intentId,
      error,
    })
  })

  return { credited: true, ledgerEntryId }
}

export async function creditProviderWalletFromGatewayItn(
  intentId: string,
): Promise<CreditFromItnResult> {
  // Payfast ITNs use the shared gateway crediting path after adapter validation.
  return creditProviderWalletFromGatewayIntent(intentId, {
    gatewayLabel: 'Payfast',
    createdBy: 'payfast-itn',
  })
}

export async function creditProviderWalletFromPayatWebhook(
  intentId: string,
): Promise<CreditFromItnResult> {
  // Pay@ webhooks use the same ledger-first crediting path after HMAC validation.
  return creditProviderWalletFromGatewayIntent(intentId, {
    gatewayLabel: 'Pay@',
    createdBy: 'payat-webhook',
  })
}

class AlreadyCreditedError extends Error {
  constructor() {
    super('already credited')
    this.name = 'AlreadyCreditedError'
  }
}

function formatZar(amountCents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amountCents / 100)
}
