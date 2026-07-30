import { db } from '@/lib/db'
import { readPayatSingleRtp } from './read'
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'
import type { InternalPayAtGoStatus } from '@/lib/payat-go/status'

export type ReconcileOutcome =
  | { action: 'credited'; ledgerEntryId: string }
  | { action: 'not_paid'; internalStatus: InternalPayAtGoStatus }
  | { action: 'skipped'; reason: string }

/**
 * Ask Pay@ what actually happened to an intent, and credit it if paid.
 *
 * This is the single decision point for both the webhook (push) and the
 * reconcile sweep (pull) so the two can never disagree. The webhook payload is
 * never trusted for status or amount — only this read is.
 */
export async function reconcilePayatIntent(intentId: string): Promise<ReconcileOutcome> {
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      amountCents: true,
      clientAccountNumber: true,
      status: true,
      creditedAt: true,
    },
  })

  if (!intent) return { action: 'skipped', reason: 'intent not found' }
  if (intent.status === 'CREDITED' || intent.creditedAt) {
    return { action: 'skipped', reason: 'already credited' }
  }
  // Intents created before clientAccountNumber was persisted cannot be read
  // back. They must be resolved via the Pay@ merchant portal by hand.
  if (!intent.clientAccountNumber) {
    return { action: 'skipped', reason: 'no clientAccountNumber' }
  }

  const state = await readPayatSingleRtp(intent.clientAccountNumber)

  // Both conditions are required. PARTIAL_PAYMENT_RECEIVED already maps to
  // FAILED, but the amount guard is kept as defence in depth so a future
  // mapping change cannot let an underpayment through.
  const paidEnough =
    state.amountPaidCents !== null && state.amountPaidCents >= intent.amountCents

  if (state.internalStatus !== 'PAID' || !paidEnough) {
    return { action: 'not_paid', internalStatus: state.internalStatus }
  }

  const credited = await creditProviderWalletFromPayatWebhook(intent.id)
  if (credited.credited) {
    return { action: 'credited', ledgerEntryId: credited.ledgerEntryId }
  }
  return { action: 'skipped', reason: credited.reason }
}
