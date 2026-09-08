// PSP webhook handler
// Receives payment events from the configured payment provider (Peach, Yoco, etc.)
// Security: HMAC signature verification before processing

import { type NextRequest, NextResponse } from 'next/server'
import {
  verifyWebhookSignature,
  parseWebhookEvent,
  handlePaymentSuccess,
  handlePaymentFailed,
} from '@/lib/payments'
import { guardPaymentSuccessWebhook } from '@/lib/payments/webhook-guards'
import { sendPaidBookingConfirmation } from '@/lib/payment-confirmation'
import { getCorrelationId } from '@/lib/correlation'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature =
    request.headers.get('x-signature') ??
    request.headers.get('x-peach-signature') ??
    request.headers.get('x-yoco-signature') ??
    ''

  const reqId = crypto.randomUUID().slice(0, 8)
  const correlationId = await getCorrelationId()
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), correlationId, event: 'webhook_received', path: request.url }))

  // Verify webhook authenticity
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn(`[webhook/payments:${reqId}] Invalid signature`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let event
  try {
    event = parseWebhookEvent(rawBody)
  } catch (err) {
    console.error(`[webhook/payments:${reqId}] Parse error:`, err)
    return NextResponse.json({ status: 'ignored' })
  }

  try {
    if (event.type === 'payment.success') {
      // Idempotency guard + amount validation (SECURITY 7a1438d) - shared
      // with the VodaPay notify route via lib/payments/webhook-guards.ts:
      //   a) bookingId maps to a known Payment (reject unknown references)
      //   b) event.amount matches Payment.amount within ±0.01 rand tolerance
      //   c) payment is not already PAID (idempotency)
      const guard = await guardPaymentSuccessWebhook({
        bookingId: event.bookingId,
        amountCents: event.amount,
      })

      if (guard.outcome === 'unknown_booking') {
        console.warn(`[webhook/payments:${reqId}] Unknown bookingId ${event.bookingId}`)
        return NextResponse.json({ error: 'Not found' }, { status: 400 })
      }

      if (guard.outcome === 'amount_mismatch') {
        console.error(`[webhook/payments:${reqId}] Amount mismatch for ${event.bookingId}`, {
          storedCents: guard.storedAmountCents,
          receivedCents: guard.receivedAmountCents,
        })
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
      }

      // Early-return BEFORE handlePaymentSuccess to prevent any duplicate DB writes.
      if (guard.outcome === 'duplicate') {
        // NEW-2b: a duplicate `success` whose incoming pspReference differs
        // from what's already stored means a SECOND, distinct session got
        // paid for this booking - a possible double charge. Loud log with a
        // distinct marker for ops/finance to grep on; still return 200 (this
        // is not a signature/parse failure and must not trigger PSP retries).
        if (guard.storedPspReference && guard.storedPspReference !== event.pspReference) {
          console.error(
            `[webhook/payments:${reqId}] DUPLICATE_SUCCESS_DIFFERENT_PSP_REFERENCE - possible double charge, manual refund needed`,
            {
              bookingId: event.bookingId,
              storedPspReference: guard.storedPspReference,
              incomingPspReference: event.pspReference,
            },
          )
        } else {
          console.info(
            `[webhook/payments:${reqId}] Duplicate delivery for ${event.bookingId} - already processed`,
          )
        }
        // SRE-02: a duplicate delivery is a free re-drive opportunity. If the
        // booking confirmation never went out (sentinel null), attempt it now.
        // sendPaidBookingConfirmation is idempotent (sentinel + attempt cap)
        // and non-throwing.
        if (!guard.bookingConfirmationSentAt) {
          const redrive = await sendPaidBookingConfirmation(event.bookingId)
          console.info(
            `[webhook/payments:${reqId}] Confirmation re-drive for ${event.bookingId}: ${redrive.outcome}`,
          )
        }
        return NextResponse.json({ status: 'ok' })
      }

      await handlePaymentSuccess(event)

      // SRE-02: the confirmation send is tracked by a sentinel on Payment and
      // never throws. A failed send no longer 500s the webhook (which used to
      // strand the confirmation behind the PAID early-return); the duplicate-
      // delivery path above and the payment-confirmation-redrive cron re-drive it.
      const confirmation = await sendPaidBookingConfirmation(event.bookingId)
      if (!confirmation.sent) {
        console.warn(
          `[webhook/payments:${reqId}] Booking confirmation not sent for ${event.bookingId}: ${confirmation.outcome}`,
        )
      }
    } else if (event.type === 'payment.failed') {
      await handlePaymentFailed(event)
    }
    // payment.refunded is handled by admin-initiated refunds in lib/payments.ts

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error(`[webhook/payments:${reqId}] Handler error:`, err)
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
}
