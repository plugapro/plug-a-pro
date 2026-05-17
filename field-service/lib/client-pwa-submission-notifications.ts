import { normaliseLocationDisplayName } from './location-format'
import { sendText } from './whatsapp'
import { sendCtaUrl } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'

/**
 * Privacy copy that must appear in the request-submitted and shortlist-ready
 * messages so customers understand when their contact details are released.
 * The exact wording is part of the Client PWA contract — do not change without
 * updating the corresponding blueprint copy.
 */
export const CLIENT_PWA_PRIVACY_COPY =
  'Your exact address and phone number are only shared after you select a provider and that provider accepts the job.'

export async function notifyCustomerPwaRequestSubmitted(params: {
  customerPhone: string | null
  category: string
  suburb: string | null
  city: string | null
  ticketUrl: string | null
  requestId: string
}) {
  if (!params.customerPhone) return { sent: false as const, reason: 'no_customer_phone' }

  const area = [params.suburb, params.city].filter(Boolean).map((value) => normaliseLocationDisplayName(value!)).join(', ')

  await sendText({
    to: params.customerPhone,
    text:
      `Request submitted\n\n` +
      `We've received your ${params.category} request${area ? ` in ${area}` : ''}.\n\n` +
      `Choose how you'd like to find a provider: Quick Match or Review Providers First.\n\n` +
      CLIENT_PWA_PRIVACY_COPY +
      (params.ticketUrl ? `\n\nYour request tracker is available below.` : ''),
    templateName: 'interactive:client_pwa_request_submitted',
    metadata: { requestId: params.requestId },
  })
  if (params.ticketUrl) {
    await sendCtaUrl(
      params.customerPhone,
      'Your request tracker is available below.',
      ctaLabelFor('view_request'),
      params.ticketUrl,
      undefined,
      { templateName: 'interactive:client_pwa_request_tracker_cta', metadata: { requestId: params.requestId } },
    )
  }

  return { sent: true as const }
}

/**
 * Sent when the matching engine transitions a request to MATCHING status —
 * i.e. a lead has been dispatched to at least one provider.
 *
 * Spec message: "Providers are being checked. We'll notify you when your
 * shortlist is ready."
 *
 * Idempotency: callers should guard on JobRequest.matchFoundWhatsappSentAt or
 * pass isAlreadySent=true to skip. This function is intentionally non-throwing
 * so a WhatsApp delivery failure never rolls back the matching transaction.
 */
export async function notifyCustomerMatchingInProgress(params: {
  customerPhone: string | null
  category: string
  requestId: string
  isAlreadySent?: boolean
}): Promise<{ sent: boolean; reason?: string }> {
  if (!params.customerPhone) return { sent: false, reason: 'no_customer_phone' }
  if (params.isAlreadySent) return { sent: false, reason: 'already_sent' }

  try {
    await sendText({
      to: params.customerPhone,
      text:
        `Quick Match in progress\n\n` +
        `We're checking with a suitable provider for your ${params.category} request now.\n\n` +
        `If they don't respond, we'll try the next suitable provider.`,
      templateName: 'interactive:client_matching_in_progress',
      metadata: { requestId: params.requestId },
    })
    return { sent: true }
  } catch (err) {
    console.error('[client-pwa-submission-notifications] notifyCustomerMatchingInProgress failed (non-fatal)', {
      requestId: params.requestId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Sent after a job has been marked COMPLETED — invites the customer to leave a
 * review and confirms the job is done.
 *
 * This covers the `review_requested` message type in the Client PWA journey spec.
 * The review URL is optional; if omitted the message still confirms completion
 * without embedding a raw URL in the body.
 *
 * Idempotency: callers should guard on a sent-flag (e.g. Job.reviewRequestSentAt)
 * before calling. This function is intentionally non-throwing.
 */
export async function notifyCustomerPaymentFailed(params: {
  customerPhone: string | null
  category: string
  bookingRef: string
}): Promise<{ sent: boolean; reason?: string }> {
  if (!params.customerPhone) return { sent: false, reason: 'no_customer_phone' }

  try {
    await sendText({
      to: params.customerPhone,
      text:
        `Payment issue on your booking\n\n` +
        `Your payment for the ${params.category} booking (Ref: ${params.bookingRef}) was not successful.\n\n` +
        `Please try again or contact us on WhatsApp if you need help. Your booking slot is still held.`,
      templateName: 'interactive:client_payment_failed',
      metadata: { bookingRef: params.bookingRef },
    })
    return { sent: true }
  } catch (err) {
    console.error('[client-pwa-submission-notifications] notifyCustomerPaymentFailed failed (non-fatal)', {
      bookingRef: params.bookingRef,
      error: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export async function notifyCustomerReviewRequested(params: {
  customerPhone: string | null
  category: string
  providerName: string | null
  requestId: string
  reviewUrl: string | null
  isAlreadySent?: boolean
}): Promise<{ sent: boolean; reason?: string }> {
  if (!params.customerPhone) return { sent: false, reason: 'no_customer_phone' }
  if (params.isAlreadySent) return { sent: false, reason: 'already_sent' }

  const provider = params.providerName?.trim() || 'Your provider'

  try {
    await sendText({
      to: params.customerPhone,
      text:
        `Your ${params.category} job is complete\n\n` +
        `${provider} has finished your job. We hope everything went well!\n\n` +
        `Your feedback helps other customers choose the right provider.` +
        (params.reviewUrl ? `\n\nYou can leave a review below.` : ''),
      templateName: 'interactive:client_review_requested',
      metadata: { requestId: params.requestId },
    })
    if (params.reviewUrl) {
      await sendCtaUrl(
        params.customerPhone,
        'You can leave a review below.',
        ctaLabelFor('view_request'),
        params.reviewUrl,
        undefined,
        { templateName: 'interactive:client_review_requested_cta', metadata: { requestId: params.requestId } },
      )
    }
    return { sent: true }
  } catch (err) {
    console.error('[client-pwa-submission-notifications] notifyCustomerReviewRequested failed (non-fatal)', {
      requestId: params.requestId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
