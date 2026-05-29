// ─── Support macro library ────────────────────────────────────────────────────
// Structured quick-reply templates for common support scenarios.
// Used by the ops team to send consistent, on-brand responses.
//
// Usage:
//   const msg = renderMacro('DISPUTE_OPENED', { customerName: 'Thabo', refId: 'JOB-1234' })
//   await sendText(phone, msg)
//
// All templates follow the marketplace-responsibility-matrix:
//   - Plug A Pro facilitates matching and records agreements.
//   - We do not guarantee workmanship, licensing or provider behaviour.
//   - Dispute resolution uses the written quote + job record as the reference.

export type MacroKey =
  | 'DISPUTE_OPENED'
  | 'DISPUTE_UPDATE'
  | 'DISPUTE_RESOLVED'
  | 'DISPUTE_ESCALATED'
  | 'CANCELLATION_RECEIVED'
  | 'CANCELLATION_CONFIRMED'
  | 'REFUND_UNDER_REVIEW'
  | 'REFUND_OUTCOME'
  | 'PAYMENT_QUERY'
  | 'BOOKING_REMINDER'
  | 'NO_SHOW_PROVIDER'
  | 'NO_SHOW_CUSTOMER'
  | 'OUT_OF_AREA'
  | 'GENERAL_ACKNOWLEDGEMENT'

type MacroVars = Record<string, string>

const MACROS: Record<MacroKey, (v: MacroVars) => string> = {

  // ─── Disputes ───────────────────────────────────────────────────────────────

  DISPUTE_OPENED: ({ customerName, refId }) =>
    `Hi ${customerName}, thanks for reaching out. We've logged your report (ref: ${refId}) and will review the written quote, job record and any photos you've shared.\n\nWe aim to respond within 2 business hours and will keep you updated as we move forward.`,

  DISPUTE_UPDATE: ({ customerName, refId, updateDetail }) =>
    `Hi ${customerName}, an update on your case (ref: ${refId}):\n\n${updateDetail}\n\nWe'll follow up again as soon as we have more information.`,

  DISPUTE_RESOLVED: ({ customerName, refId, outcome }) =>
    `Hi ${customerName}, your case (ref: ${refId}) has been resolved.\n\n${outcome}\n\nIf you have further questions, reply to this message.`,

  DISPUTE_ESCALATED: ({ customerName, refId }) =>
    `Hi ${customerName}, your case (ref: ${refId}) has been escalated for senior review. We'll follow up within 1 business day.`,

  // ─── Cancellations ──────────────────────────────────────────────────────────

  CANCELLATION_RECEIVED: ({ customerName, bookingRef }) =>
    `Hi ${customerName}, we've received your cancellation request for booking ${bookingRef}. We're reviewing the booking stage and will confirm the outcome within 2 business hours.`,

  CANCELLATION_CONFIRMED: ({ customerName, bookingRef, refundNote }) =>
    `Hi ${customerName}, your booking (${bookingRef}) has been cancelled.\n\n${refundNote}\n\nReply if you'd like to book again.`,

  // ─── Refunds ────────────────────────────────────────────────────────────────

  REFUND_UNDER_REVIEW: ({ customerName, refId }) =>
    `Hi ${customerName}, your refund request (ref: ${refId}) is under review. We're checking the booking stage and payment method. We'll update you within 2 business hours.\n\nNote: refund eligibility depends on when the cancellation was made and whether work had started.`,

  REFUND_OUTCOME: ({ customerName, refId, outcome }) =>
    `Hi ${customerName}, your refund review (ref: ${refId}) is complete.\n\n${outcome}\n\nReply if you have questions.`,

  // ─── Payment queries ─────────────────────────────────────────────────────────

  PAYMENT_QUERY: ({ customerName }) =>
    `Hi ${customerName}, payment is arranged through the platform after the job is done. The method will be confirmed with you at booking. If you have a specific question about a payment, reply with your booking reference and we'll check it for you.`,

  // ─── Reminders ───────────────────────────────────────────────────────────────

  BOOKING_REMINDER: ({ recipientName, bookingRef, dateTime, area }) =>
    `Hi ${recipientName}, a reminder about your upcoming booking (${bookingRef}):\n\n📅 ${dateTime}\n📍 ${area}\n\nReply if you need to make any changes.`,

  // ─── No-shows ────────────────────────────────────────────────────────────────

  NO_SHOW_PROVIDER: ({ customerName, bookingRef }) =>
    `Hi ${customerName}, we're sorry the provider didn't arrive for booking ${bookingRef}. We've logged this and will follow up with you within 2 hours to arrange a resolution - this may include rescheduling or cancellation.\n\nWe take no-shows seriously and they affect the provider's standing on the platform.`,

  NO_SHOW_CUSTOMER: ({ providerName, bookingRef }) =>
    `Hi ${providerName}, the customer was not available for booking ${bookingRef}. We've logged this and will follow up with you within 2 hours. Any travel or preparation costs will be considered as part of the review.`,

  // ─── Operational ─────────────────────────────────────────────────────────────

  OUT_OF_AREA: ({ customerName, area }) =>
    `Hi ${customerName}, we don't currently have active providers in ${area}. We've noted your interest - we'll let you know when we expand to your area. You're welcome to try again once we've launched nearby.`,

  GENERAL_ACKNOWLEDGEMENT: ({ customerName }) =>
    `Hi ${customerName}, thanks for your message. A member of our team will follow up with you within 2 business hours (Mon–Fri 8am–6pm, Sat 8am–2pm).`,
}

/** Render a support macro with the given variables. */
export function renderMacro(key: MacroKey, vars: MacroVars): string {
  const fn = MACROS[key]
  return fn(vars)
}
