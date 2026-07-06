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
import { sendPaidBookingConfirmation } from '@/lib/payment-confirmation'
import { db } from '@/lib/db'
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
      // Idempotency guard + amount validation (SECURITY 7a1438d):
      // Load the stored Payment record to verify:
      //   a) m_payment_id maps to a known Payment (reject unknown references)
      //   b) event.amount matches Payment.amount within ±0.01 rand tolerance
      //   c) payment is not already PAID (idempotency)
      const existingPayment = await db.payment.findUnique({
        where: { bookingId: event.bookingId },
        select: { status: true, amount: true, bookingConfirmationSentAt: true },
      })

      if (!existingPayment) {
        console.warn(`[webhook/payments:${reqId}] Unknown bookingId ${event.bookingId}`)
        return NextResponse.json({ error: 'Not found' }, { status: 400 })
      }

      // Amount validation: compare event amount (cents) against stored amount (rand).
      // Tolerance: ±1 cent (0.01 rand) to account for floating-point rounding.
      const storedAmountCents = Math.round(Number(existingPayment.amount) * 100)
      const tolerance = 1 // cent
      if (Math.abs(event.amount - storedAmountCents) > tolerance) {
        console.error(`[webhook/payments:${reqId}] Amount mismatch for ${event.bookingId}`, {
          storedCents: storedAmountCents,
          receivedCents: event.amount,
        })
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
      }

      // Early-return BEFORE handlePaymentSuccess to prevent any duplicate DB writes.
      if (existingPayment.status === 'PAID') {
        console.info(
          `[webhook/payments:${reqId}] Duplicate delivery for ${event.bookingId} - already processed`,
        )
        // SRE-02: a duplicate delivery is a free re-drive opportunity. If the
        // booking confirmation never went out (sentinel null), attempt it now.
        // sendPaidBookingConfirmation is idempotent (sentinel + attempt cap)
        // and non-throwing.
        if (!existingPayment.bookingConfirmationSentAt) {
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
