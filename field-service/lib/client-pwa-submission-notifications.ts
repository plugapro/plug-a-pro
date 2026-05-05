import { normaliseLocationDisplayName } from './location-format'
import { sendText } from './whatsapp'
import { sendCtaUrl } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'

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
      `We're checking suitable providers in your area. We'll notify you when your shortlist is ready.` +
      (params.ticketUrl ? `\n\nYour request tracker is available below.` : ''),
    templateName: 'interactive:client_pwa_request_submitted',
    metadata: { requestId: params.requestId },
  })
  if (params.ticketUrl) {
    await sendCtaUrl(
      params.customerPhone,
      'Your request tracker is available below.',
      ctaLabelFor('generic_details'),
      params.ticketUrl,
      undefined,
      { templateName: 'interactive:client_pwa_request_tracker_cta', metadata: { requestId: params.requestId } },
    )
  }

  return { sent: true as const }
}
