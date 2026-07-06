// ─── Booking-confirmation delivery for PAID payments (SRE-02) ────────────────
// The post-payment WhatsApp booking confirmation used to be fire-once inside
// the PSP webhook handler: a send failure 500'd the webhook, the PSP retry hit
// the PAID early-return, and the confirmation was lost forever.
//
// This module makes that send re-drivable:
//   - Payment.bookingConfirmationSentAt is set ONLY after a successful send.
//   - Payment.bookingConfirmationAttempts caps retries (a permanently failing
//     recipient never loops forever).
//   - Callers: the payments webhook (first delivery AND the PAID duplicate-
//     delivery path) and the payment-confirmation-redrive cron.
//
// Not flag-gated: this is a reliability fix for an already-intended message
// (booking_confirmation), not a new message type. It is only reachable once a
// Payment has transitioned to PAID via a PSP, which cannot happen in bypass mode.

import { db } from './db'
import { sendBookingConfirmation } from './whatsapp'
import { getJobRequestAccessUrl } from './job-request-access'

export const MAX_BOOKING_CONFIRMATION_ATTEMPTS = 5

export type BookingConfirmationOutcome =
  | 'sent'
  | 'no_payment'
  | 'already_sent'
  | 'not_paid'
  | 'attempts_exhausted'
  | 'no_recipient'
  | 'send_failed'

export type BookingConfirmationResult = {
  sent: boolean
  outcome: BookingConfirmationOutcome
  failureReason?: string
}

/**
 * Send the WhatsApp booking confirmation for a PAID payment, exactly once.
 * Non-throwing: a send failure is reported in the result (and left re-drivable
 * for the next webhook retry / cron sweep) rather than propagated.
 */
export async function sendPaidBookingConfirmation(
  bookingId: string,
): Promise<BookingConfirmationResult> {
  const payment = await db.payment.findUnique({
    where: { bookingId },
    select: {
      status: true,
      bookingConfirmationSentAt: true,
      bookingConfirmationAttempts: true,
    },
  })

  if (!payment) return { sent: false, outcome: 'no_payment' }
  if (payment.bookingConfirmationSentAt) return { sent: false, outcome: 'already_sent' }
  if (payment.status !== 'PAID') return { sent: false, outcome: 'not_paid' }
  if (payment.bookingConfirmationAttempts >= MAX_BOOKING_CONFIRMATION_ATTEMPTS) {
    return { sent: false, outcome: 'attempts_exhausted' }
  }

  // Count the attempt BEFORE sending so a crash mid-send still consumes an
  // attempt - the cap must bound WhatsApp traffic, not just clean failures.
  await db.payment.update({
    where: { bookingId },
    data: { bookingConfirmationAttempts: { increment: 1 } },
  })

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      match: { include: { jobRequest: { include: { customer: true } } } },
    },
  })

  const customer = booking?.match?.jobRequest?.customer
  if (!booking || !customer || !booking.scheduledDate) {
    console.error('[payment-confirmation] PAID payment has no confirmable booking/customer', {
      bookingId,
    })
    return { sent: false, outcome: 'no_recipient' }
  }

  const window = booking.scheduledWindow ?? 'TBC'
  const dateLabel = booking.scheduledDate.toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const ticketUrl = await getJobRequestAccessUrl(booking.match.jobRequest.id).catch(() => null)

  try {
    await sendBookingConfirmation({
      bookingId: booking.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      serviceName: booking.match.jobRequest.category,
      scheduledWindow: `${dateLabel}, ${window}`,
      bookingUrl: ticketUrl ?? (process.env.NEXT_PUBLIC_APP_URL ?? ''),
    })
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err)
    console.error('[payment-confirmation] booking confirmation send failed - will re-drive', {
      bookingId,
      attempts: payment.bookingConfirmationAttempts + 1,
      error: failureReason,
    })
    return { sent: false, outcome: 'send_failed', failureReason }
  }

  // Sentinel write is best-effort: if it fails the worst case is one duplicate
  // confirmation on the next re-drive, which beats silently losing the message.
  await db.payment
    .update({
      where: { bookingId },
      data: { bookingConfirmationSentAt: new Date() },
    })
    .catch((err: unknown) => {
      console.error('[payment-confirmation] failed to record confirmation sentinel', {
        bookingId,
        error: err,
      })
    })

  return { sent: true, outcome: 'sent' }
}
