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

  // Verify webhook authenticity
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('[webhook/payments] Invalid signature')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let event
  try {
    event = parseWebhookEvent(rawBody)
  } catch (err) {
    console.error('[webhook/payments] Parse error:', err)
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    if (event.type === 'payment.success') {
      await handlePaymentSuccess(event)

      // Send WhatsApp booking confirmation
      const booking = await db.booking.findUnique({
        where: { id: event.bookingId },
        include: { customer: true, service: true },
      })

      if (booking?.customer && booking.scheduledDate) {
        const window = booking.scheduledWindow ?? 'TBC'
        const dateLabel = booking.scheduledDate.toLocaleDateString('en-ZA', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })

        await sendBookingConfirmation({
          businessId: booking.businessId,
          bookingId: booking.id,
          customerName: booking.customer.name,
          customerPhone: booking.customer.phone,
          serviceName: booking.service.name,
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
    console.error('[webhook/payments] Handler error:', err)
    // Return 200 to prevent retries on known-bad events
    return NextResponse.json({ status: 'error', message: String(err) })
  }
}
