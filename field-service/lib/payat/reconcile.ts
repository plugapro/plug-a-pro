import { db } from '@/lib/db'
import { readPayatSingleRtp } from './read'
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'
import { resolveExpectedPayatAmountCents } from './expected-amount'
import type { InternalPayAtGoStatus } from '@/lib/payat-go/status'

export type ReconcileOutcome =
  | { action: 'credited'; ledgerEntryId: string }
  | { action: 'not_paid'; internalStatus: InternalPayAtGoStatus }
  | {
      action: 'indeterminate'
      internalStatus: InternalPayAtGoStatus
      expectedAmountCents: number
      amountPaidCents: number | null
    }
  | { action: 'skipped'; reason: string }

/**
 * The ONLY states that positively mean no money arrived at a till.
 *
 * An intent may be expired on these and nothing else. Expiry is irreversible -
 * EXPIRED is not in GATEWAY_CREDITABLE_STATUSES, so once the sweep expires an
 * intent no code path can ever credit it again. Deferring costs one hour;
 * expiring wrongly costs the provider their money.
 */
const CONFIRMED_UNPAID_STATUSES: ReadonlySet<InternalPayAtGoStatus> = new Set<InternalPayAtGoStatus>([
  'SENT',
  'EXPIRED',
  'CANCELLED',
])

/**
 * Ask Pay@ what actually happened to an intent, and credit it if paid.
 *
 * This is the single decision point for both the webhook (push) and the
 * reconcile sweep (pull) so the two can never disagree. The webhook payload is
 * never trusted for status or amount - only this read is.
 *
 * Three-way outcome, deliberately:
 *   - `credited`      Pay@ says PAID for at least the requested amount.
 *   - `not_paid`      Pay@ positively says no money arrived (or is still in
 *                     flight as PENDING, which the caller defers).
 *   - `indeterminate` We cannot confirm either way: PAID but the paid amount is
 *                     missing or does not match, FAILED (which includes
 *                     PARTIAL_PAYMENT_RECEIVED and PAYMENT_FEES_ISSUE - both
 *                     mean real money was handed over at a till), or a state we
 *                     could not map. The caller must NOT expire these.
 *
 * `indeterminate` never credits. Crediting still requires PAID *and* a
 * confirmed sufficient amount; this distinction is only about what may be
 * expired.
 */
export async function reconcilePayatIntent(intentId: string): Promise<ReconcileOutcome> {
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      amountCents: true,
      metadata: true,
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

  // Compare against what we actually asked Pay@ for - credit value PLUS the
  // counter fee - resolved through the same helper the legacy webhook path
  // uses. Comparing against the pre-fee amountCents would accept a payment
  // that covers the credits but not the fee.
  const expectedAmountCents = resolveExpectedPayatAmountCents(intent.metadata, intent.amountCents)

  // Both conditions are required for a credit. No magnitude heuristic is
  // applied to amountPaidCents: if Pay@ ever reports rands, a heuristic that
  // multiplied small values by 100 would let an R1 payment satisfy an R100
  // intent. An amount we cannot confirm is indeterminate, never "close enough".
  const paidEnough =
    state.amountPaidCents !== null && state.amountPaidCents >= expectedAmountCents

  if (state.internalStatus === 'PAID' && paidEnough) {
    const credited = await creditProviderWalletFromPayatWebhook(intent.id)
    if (credited.credited) {
      return { action: 'credited', ledgerEntryId: credited.ledgerEntryId }
    }
    return { action: 'skipped', reason: credited.reason }
  }

  // PENDING (PROCESSING_PAYMENT / PAYMENT_READY_FOR_SETTLEMENT) is reported as
  // not_paid so it is never credited, but the caller defers rather than expires
  // it - money is mid-settlement. The confirmed-unpaid states are the only ones
  // an expiry may act on.
  if (state.internalStatus === 'PENDING' || CONFIRMED_UNPAID_STATUSES.has(state.internalStatus)) {
    return { action: 'not_paid', internalStatus: state.internalStatus }
  }

  // PAID-with-unconfirmable-amount, FAILED (PARTIAL_PAYMENT_RECEIVED /
  // PAYMENT_FEES_ISSUE) and UNKNOWN all land here. Money may well have been
  // paid; we simply cannot prove it from this read.
  return {
    action: 'indeterminate',
    internalStatus: state.internalStatus,
    expectedAmountCents,
    amountPaidCents: state.amountPaidCents,
  }
}
