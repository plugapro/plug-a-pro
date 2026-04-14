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
import { sendBookingConfirmation } from '@/lib/whatsapp'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature =
    request.headers.get('x-signature') ??
    request.headers.get('x-peach-signature') ??
    request.headers.get('x-yoco-signature') ??
    ''

  const reqId = crypto.randomUUID().slice(0, 8)

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
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    if (event.type === 'payment.success') {
      // Idempotency guard: check status BEFORE applying the payment success handler.
      // If the booking is already SCHEDULED, the confirmation was already sent on a
      // previous delivery of this webhook — do not send it again.
      const existingBooking = await db.booking.findUnique({
        where: { id: event.bookingId },
        select: { status: true },
      })

      // Early-return BEFORE handlePaymentSuccess to prevent any duplicate DB writes.
      // handlePaymentSuccess is idempotent in isolation, but we still avoid the write.
      if (existingBooking?.status === 'SCHEDULED') {
        console.info(
          `[webhook/payments:${reqId}] Duplicate delivery for ${event.bookingId} — already processed`,
        )
        return NextResponse.json({ status: 'ok' })
      }

      await handlePaymentSuccess(event)

      const booking = await db.booking.findUnique({
        where: { id: event.bookingId },
        include: {
          match: { include: { jobRequest: { include: { customer: true } } } },
        },
      })

      const customer = booking?.match?.jobRequest?.customer
      if (customer && booking?.scheduledDate) {
        const window = booking.scheduledWindow ?? 'TBC'
        const dateLabel = booking.scheduledDate.toLocaleDateString('en-ZA', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })

        await sendBookingConfirmation({
          bookingId: booking.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          serviceName: booking.match.jobRequest.category,
          scheduledWindow: `${dateLabel}, ${window}`,
          bookingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/bookings/${booking.id}`,
        })
      }
    } else if (event.type === 'payment.failed') {
      await handlePaymentFailed(event)
    }
    // payment.refunded is handled by admin-initiated refunds in lib/payments.ts

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error(`[webhook/payments:${reqId}] Handler error:`, err)
    // Return 200 to prevent retries on known-bad events
    return NextResponse.json({ status: 'error' })
  }
}
