import { db } from './db'
import { sendCtaUrl } from './whatsapp-interactive'

function toWaUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/^\+/, '').replace(/\D/g, '')}`
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0]
}

/**
 * Sends each party a WhatsApp message with a direct CTA to message the other party.
 * Called after sendAcceptedLockConfirmations() — fire-and-forget; errors are logged.
 */
export async function sendPostMatchIntroductions(params: {
  leadId: string
  providerId: string
}): Promise<void> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      providerId: true,
      provider: { select: { name: true, phone: true } },
      jobRequest: {
        select: {
          customer: { select: { name: true, phone: true } },
          address: { select: { suburb: true } },
        },
      },
    },
  })

  if (!lead || lead.providerId !== params.providerId) return

  const providerFirst = firstName(lead.provider.name)
  const customerFirst = firstName(lead.jobRequest.customer.name)
  const suburb = lead.jobRequest.address?.suburb ?? 'your area'

  const customerBody = [
    `Your confirmed provider is *${providerFirst}* from Plug A Pro.`,
    '',
    `They will contact you soon to confirm their arrival time. Tap below to message them on WhatsApp.`,
  ].join('\n')

  const providerBody = [
    `Your job with ${customerFirst} in *${suburb}* is confirmed.`,
    '',
    `Message them to arrange your arrival time.`,
  ].join('\n')

  await Promise.allSettled([
    sendCtaUrl(
      lead.jobRequest.customer.phone,
      customerBody,
      `Message ${providerFirst}`,
      toWaUrl(lead.provider.phone),
      undefined,
      {
        templateName: 'post_match_intro:customer',
        metadata: { leadId: lead.id, providerId: params.providerId },
      },
    ).catch((err: unknown) => {
      console.error('[post-match-intro] customer intro failed', {
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }),

    sendCtaUrl(
      lead.provider.phone,
      providerBody,
      `Message ${customerFirst}`,
      toWaUrl(lead.jobRequest.customer.phone),
      undefined,
      {
        templateName: 'post_match_intro:provider',
        metadata: { leadId: lead.id, providerId: params.providerId },
      },
    ).catch((err: unknown) => {
      console.error('[post-match-intro] provider intro failed', {
        leadId: lead.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }),
  ])
}
