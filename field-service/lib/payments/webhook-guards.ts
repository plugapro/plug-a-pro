// ─── Shared PSP webhook guards ────────────────────────────────────────────────
// Amount-match and idempotency logic, extracted verbatim from the original
// inline implementation in app/api/webhooks/payments/route.ts (SECURITY
// 7a1438d) so that both the generic PSP webhook route and the VodaPay notify
// route (Task 17) apply IDENTICAL rules before ever touching handlePaymentSuccess:
//   a) the event's bookingId maps to a known Payment row (reject unknown refs)
//   b) event.amount (cents) matches Payment.amount (rand) within ±0.01 rand
//   c) the payment is not already PAID (idempotency against webhook retries)
//
// Deliberately DB-only + pure: no logging, no response shaping. Callers keep
// their own request-scoped logging (reqId, correlationId) and HTTP response
// construction, so behaviour that was route-specific stays route-specific.
import 'server-only'

import { db } from '@/lib/db'

// Tolerance: ±1 cent (0.01 rand) to account for floating-point rounding.
const AMOUNT_TOLERANCE_CENTS = 1

export type PaymentSuccessGuardResult =
  | { outcome: 'unknown_booking' }
  | { outcome: 'amount_mismatch'; storedAmountCents: number; receivedAmountCents: number }
  // NEW-2b: storedPspReference lets the caller detect a duplicate `success`
  // whose incoming pspReference differs from what we already recorded -
  // that means a SECOND, distinct live session for the same booking got
  // paid (the "two payable sessions" hazard NEW-2a mitigates at mint time),
  // a possible double charge that needs a loud log and manual follow-up
  // rather than the routine "duplicate delivery" info log.
  | { outcome: 'duplicate'; bookingConfirmationSentAt: Date | null; storedPspReference: string | null }
  | { outcome: 'proceed' }

/**
 * Applies the amount-match + idempotency guard for a `payment.success` event.
 * Loads the stored Payment row for `bookingId` and returns which guard (if
 * any) fired, so the caller can reproduce the exact prior log lines/HTTP
 * responses. Does not mutate anything and does not call handlePaymentSuccess.
 */
export async function guardPaymentSuccessWebhook(params: {
  bookingId: string
  amountCents: number
}): Promise<PaymentSuccessGuardResult> {
  const existingPayment = await db.payment.findUnique({
    where: { bookingId: params.bookingId },
    select: { status: true, amount: true, bookingConfirmationSentAt: true, pspReference: true },
  })

  if (!existingPayment) {
    return { outcome: 'unknown_booking' }
  }

  // Amount validation: compare event amount (cents) against stored amount (rand).
  // I-3: a non-numeric/undefined provider amount parses to NaN upstream (e.g.
  // Number("abc") or parseFloat(undefined)); Math.abs(NaN - x) > tolerance is
  // FALSE, so without an explicit finiteness check a malformed amount would
  // silently pass this guard. Reject it as a mismatch instead.
  const storedAmountCents = Math.round(Number(existingPayment.amount) * 100)
  if (
    !Number.isFinite(params.amountCents) ||
    Math.abs(params.amountCents - storedAmountCents) > AMOUNT_TOLERANCE_CENTS
  ) {
    return {
      outcome: 'amount_mismatch',
      storedAmountCents,
      receivedAmountCents: params.amountCents,
    }
  }

  // Early-return BEFORE handlePaymentSuccess to prevent any duplicate DB writes.
  if (existingPayment.status === 'PAID') {
    return {
      outcome: 'duplicate',
      bookingConfirmationSentAt: existingPayment.bookingConfirmationSentAt,
      storedPspReference: existingPayment.pspReference,
    }
  }

  return { outcome: 'proceed' }
}
