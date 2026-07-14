// ─── Customer payment-link delivery (CJ-01) ──────────────────────────────────
// Checkout URLs used to be generated, persisted, and then discarded - in
// checkout mode the customer literally never received a way to pay. This
// module actually delivers the link over WhatsApp.
//
// Gating: HARD-GATED to checkout mode (PAYMENT_COLLECTION_MODE === 'checkout').
// Production currently runs bypass mode, so nothing here is reachable in prod
// until checkout mode is deliberately enabled - which is why this ships
// without a feature flag (per the "only reachable in checkout mode" rule).
//
// Window-safety: there is no approved WhatsApp template for payment links yet,
// so the send is a free-form CTA (URL travels via the CTA button, never inline
// in the body - see assertNoRawUrlsInWhatsAppBody). Free-form sends only
// deliver inside Meta's 24h customer-service window, so we check
// hasRecentInboundWhatsappSession first and record a blocked outcome instead
// of firing a doomed send. sendCtaUrl logs the outbound MessageEvent itself
// via the context parameter.

import 'server-only'

import { db } from './db'
import { getPaymentCollectionMode, initializeBookingPayment } from './payments'
import { formatCurrency } from './currency'
import { hasRecentInboundWhatsappSession } from './whatsapp-policy'
import { ctaLabelFor } from './whatsapp-copy'

export type PaymentLinkDeliveryOutcome =
  | 'sent'
  | 'bypass_mode'
  | 'no_checkout_url'
  | 'no_customer_phone'
  | 'outside_window_blocked'
  | 'send_error'

export type PaymentLinkDeliveryResult = {
  sent: boolean
  outcome: PaymentLinkDeliveryOutcome
  failureReason?: string
}

/**
 * Send the customer a window-safe WhatsApp CTA with the checkout URL for a
 * booking. Non-throwing. Returns `bypass_mode` (and sends nothing) unless
 * PAYMENT_COLLECTION_MODE === 'checkout'.
 */
export async function deliverBookingPaymentLink(params: {
  bookingId: string
  checkoutUrl: string | null
  customerPhone?: string | null
  amountRand?: number | null
  category?: string | null
  /** Extra reference line (e.g. Pay@ reference) shown in the message body. */
  referenceLine?: string | null
}): Promise<PaymentLinkDeliveryResult> {
  // Bypass mode must remain completely untouched: no lookups, no sends.
  if (getPaymentCollectionMode() !== 'checkout') {
    return { sent: false, outcome: 'bypass_mode' }
  }
  if (!params.checkoutUrl) {
    return { sent: false, outcome: 'no_checkout_url' }
  }

  try {
    let customerPhone = params.customerPhone ?? null
    let category = params.category ?? null
    if (!customerPhone || !category) {
      const booking = await db.booking.findUnique({
        where: { id: params.bookingId },
        select: {
          match: {
            select: {
              jobRequest: {
                select: {
                  category: true,
                  customer: { select: { phone: true } },
                },
              },
            },
          },
        },
      })
      customerPhone = customerPhone ?? booking?.match?.jobRequest.customer.phone ?? null
      category = category ?? booking?.match?.jobRequest.category ?? null
    }

    if (!customerPhone) {
      return { sent: false, outcome: 'no_customer_phone' }
    }

    // Free-form CTA sends only deliver inside the 24h customer-service window.
    // Outside it we record the blocked state loudly instead of a doomed send;
    // ops can follow up manually (and CJ-13's failure path re-offers the link).
    const windowOpen = await hasRecentInboundWhatsappSession(customerPhone).catch(() => false)
    if (!windowOpen) {
      console.error('[payment-link-delivery] payment link blocked: customer outside 24h window', {
        bookingId: params.bookingId,
        outcome: 'outside_window_blocked',
      })
      return {
        sent: false,
        outcome: 'outside_window_blocked',
        failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
      }
    }

    const bookingRef = params.bookingId.slice(-8).toUpperCase()
    const categoryLabel = (category ?? 'service').replaceAll('_', ' ')
    const lines = [
      `Payment for your ${categoryLabel} booking`,
      '',
      `Booking ref: ${bookingRef}`,
      params.amountRand != null ? `Amount: ${formatCurrency(params.amountRand)}` : null,
      params.referenceLine ?? null,
      '',
      'Use the secure button below to pay and confirm your booking.',
    ].filter((line): line is string => line !== null)

    const { sendCtaUrl } = await import('./whatsapp-interactive')
    await sendCtaUrl(
      customerPhone,
      lines.join('\n'),
      ctaLabelFor('payment'),
      params.checkoutUrl,
      { footer: 'Secure payment link for this booking only.' },
      {
        bookingId: params.bookingId,
        templateName: 'interactive:booking_payment_link',
        metadata: { bookingId: params.bookingId, bookingRef },
      },
    )
    return { sent: true, outcome: 'sent' }
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err)
    console.error('[payment-link-delivery] payment link send failed (non-fatal)', {
      bookingId: params.bookingId,
      error: failureReason,
    })
    return { sent: false, outcome: 'send_error', failureReason }
  }
}

/**
 * Checkout-mode-only convenience for booking-creation paths that have not yet
 * initialized a payment (e.g. quote approval): initialize the checkout, then
 * deliver the link. A no-op in bypass mode - it must never create the
 * PLATFORM_CHECKOUT payment row bypass mode doesn't expect.
 */
export async function initializeCheckoutAndDeliverPaymentLink(params: {
  bookingId: string
  amountRand: number
  customerPhone?: string | null
  customerEmail?: string | null
  category?: string | null
  description: string
}): Promise<PaymentLinkDeliveryResult> {
  if (getPaymentCollectionMode() !== 'checkout') {
    return { sent: false, outcome: 'bypass_mode' }
  }

  try {
    const setup = await initializeBookingPayment({
      bookingId: params.bookingId,
      amountRand: params.amountRand,
      customerEmail: params.customerEmail ?? null,
      customerPhone: params.customerPhone ?? null,
      description: params.description,
    })
    return deliverBookingPaymentLink({
      bookingId: params.bookingId,
      checkoutUrl: setup.checkoutUrl,
      customerPhone: params.customerPhone,
      amountRand: params.amountRand,
      category: params.category,
    })
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err)
    console.error('[payment-link-delivery] checkout initialization failed (non-fatal)', {
      bookingId: params.bookingId,
      error: failureReason,
    })
    return { sent: false, outcome: 'send_error', failureReason }
  }
}
