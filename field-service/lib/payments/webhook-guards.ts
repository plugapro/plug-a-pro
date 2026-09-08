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
  | { outcome: 'duplicate'; bookingConfirmationSentAt: Date | null }
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
    select: { status: true, amount: true, bookingConfirmationSentAt: true },
  })

  if (!existingPayment) {
    return { outcome: 'unknown_booking' }
  }

  // Amount validation: compare event amount (cents) against stored amount (rand).
  const storedAmountCents = Math.round(Number(existingPayment.amount) * 100)
  if (Math.abs(params.amountCents - storedAmountCents) > AMOUNT_TOLERANCE_CENTS) {
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
    }
  }

  return { outcome: 'proceed' }
}
