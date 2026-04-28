import { db } from './db'
import { recordAuditLog } from './audit'
import { AUDIT_ENTITY } from './audit-entities'
import { getProviderLeadAccessUrlByLeadId } from './provider-lead-access'

const SENT_OR_BETTER = ['SENT', 'DELIVERED', 'READ'] as const

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function providerDisplayName(providerName: string | null | undefined) {
  const name = providerName?.trim()
  return name ? `${name} from Plug A Pro` : 'Your Plug A Pro provider'
}

function areaLabel(address: { suburb?: string | null; city?: string | null } | null | undefined) {
  return [address?.suburb, address?.city].filter(Boolean).join(', ') || 'Location on ticket'
}

function addressLabel(address: { street?: string | null; suburb?: string | null; city?: string | null; province?: string | null } | null | undefined) {
  return [address?.street, address?.suburb, address?.city, address?.province].filter(Boolean).join(', ') || 'View the signed job link for the address'
}

function whatsappDirectUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

async function hasSentPostMatchMessage(params: {
  to: string
  templateName: string
  leadId: string
}) {
  const existing = await db.messageEvent.findFirst({
    where: {
      to: params.to,
      templateName: params.templateName,
      status: { in: [...SENT_OR_BETTER] },
      metadata: {
        path: ['leadId'],
        equals: params.leadId,
      },
    },
    select: { id: true },
  })
  return Boolean(existing)
}

export async function notifyPostMatchAcceptance(params: {
  leadId: string
  providerId: string
  matchId: string
}) {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: {
      provider: { select: { id: true, name: true, phone: true } },
      jobRequest: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: { select: { street: true, suburb: true, city: true, province: true } },
        },
      },
    },
  })

  if (!lead || lead.providerId !== params.providerId) return

  const customer = lead.jobRequest.customer
  const provider = lead.provider
  const ref = lead.jobRequest.id.slice(-8).toUpperCase()
  const providerName = provider.name?.trim() || 'your Plug A Pro provider'
  const customerName = firstName(customer.name)
  const category = lead.jobRequest.category
  const area = areaLabel(lead.jobRequest.address)
  const address = addressLabel(lead.jobRequest.address)
  const leadUrl = await getProviderLeadAccessUrlByLeadId(lead.id)

  const { sendText, sendCtaUrl, sendButtons } = await import('./whatsapp-interactive')

  if (customer.phone && !(await hasSentPostMatchMessage({
    to: customer.phone,
    templateName: 'post_match_customer_provider_accepted',
    leadId: lead.id,
  }))) {
    await sendText(
      customer.phone,
      `🎉 *Great news, ${customerName}!*\n\n*${providerDisplayName(provider.name)}* has accepted your *${category}* request.\n\n${providerName} will be in touch shortly to confirm the details and next steps.\n\nReply *status* anytime to check your booking.`,
      {
        templateName: 'post_match_customer_provider_accepted',
        metadata: {
          leadId: lead.id,
          jobRequestId: lead.jobRequestId,
          matchId: params.matchId,
          providerId: provider.id,
        },
      },
    )
  }

  if (provider.phone && !(await hasSentPostMatchMessage({
    to: provider.phone,
    templateName: 'post_match_provider_job_accepted',
    leadId: lead.id,
  }))) {
    const body =
      `✅ *Job accepted! — ${firstName(provider.name)}*\n\n` +
      `Your client *${customerName}* has been notified that you accepted the *${category}* job.\n\n` +
      `Please confirm when you plan to arrive.\n\n` +
      `Service: *${category}*\n` +
      `Area: *${area}*\n` +
      `Address: *${address}*\n` +
      `Ref: *${ref}*\n\n` +
      `Open the job to view full details, customer notes, photos, and update your arrival time.`

    if (leadUrl) {
      await sendCtaUrl(
        provider.phone,
        body,
        'View Job',
        leadUrl,
        { footer: 'Customer contact is released only after acceptance' },
        {
          templateName: 'post_match_provider_job_accepted',
          metadata: {
            leadId: lead.id,
            jobRequestId: lead.jobRequestId,
            matchId: params.matchId,
            providerId: provider.id,
          },
        },
      )
    } else {
      await sendText(provider.phone, body, {
        templateName: 'post_match_provider_job_accepted',
        metadata: {
          leadId: lead.id,
          jobRequestId: lead.jobRequestId,
          matchId: params.matchId,
          providerId: provider.id,
        },
      })
    }
  }

  if (provider.phone && !(await hasSentPostMatchMessage({
    to: provider.phone,
    templateName: 'post_match_provider_next_actions',
    leadId: lead.id,
  }))) {
    await sendButtons(
      provider.phone,
      'Next action: contact the customer shortly to confirm the details. This handover is logged on the ticket.',
      [{ id: `post_match_contact:${lead.id}`, title: 'Contact Customer' }],
      { footer: 'Use this only after accepting the job.' },
      {
        templateName: 'post_match_provider_next_actions',
        metadata: {
          leadId: lead.id,
          jobRequestId: lead.jobRequestId,
          matchId: params.matchId,
          providerId: provider.id,
        },
      },
    )
  }

  await recordAuditLog({
    actorId: provider.id,
    actorRole: 'provider',
    action: 'match.accepted.communication_started',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    after: {
      leadId: lead.id,
      matchId: params.matchId,
      providerId: provider.id,
      customerContactReleased: true,
    },
  }).catch(() => {})
}

export async function buildAcceptedLeadContactUrl(params: {
  leadId: string
  token: string
}) {
  const { resolveProviderLeadAccessToken } = await import('./provider-lead-access')
  const resolved = await resolveProviderLeadAccessToken(params.token)
  if (resolved.status !== 'active' || !resolved.lead || resolved.lead.id !== params.leadId) {
    return null
  }
  if (resolved.lead.status !== 'ACCEPTED') return null

  const customerPhone = resolved.lead.jobRequest.customer?.phone
  if (!customerPhone) return null

  await recordAuditLog({
    actorId: resolved.lead.providerId,
    actorRole: 'provider',
    action: 'match.customer_contact_opened',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: resolved.lead.jobRequestId,
    after: {
      leadId: resolved.lead.id,
      providerId: resolved.lead.providerId,
    },
  }).catch(() => {})

  return whatsappDirectUrl(
    customerPhone,
    `Hi ${firstName(resolved.lead.jobRequest.customer?.name)}, this is ${resolved.lead.provider.name} from Plug A Pro. I accepted your ${resolved.lead.jobRequest.category} request and would like to confirm the details.`
  )
}

export async function buildAcceptedLeadContactUrlForProvider(params: {
  leadId: string
  providerPhone: string
}) {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: {
      provider: { select: { id: true, name: true, phone: true } },
      jobRequest: {
        include: {
          customer: { select: { name: true, phone: true } },
        },
      },
    },
  })

  if (!lead || lead.provider.phone !== params.providerPhone || lead.status !== 'ACCEPTED') {
    return null
  }

  const customerPhone = lead.jobRequest.customer?.phone
  if (!customerPhone) return null

  await recordAuditLog({
    actorId: lead.providerId,
    actorRole: 'provider',
    action: 'match.customer_contact_opened',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    after: {
      leadId: lead.id,
      providerId: lead.providerId,
      source: 'whatsapp_action',
    },
  }).catch(() => {})

  return whatsappDirectUrl(
    customerPhone,
    `Hi ${firstName(lead.jobRequest.customer?.name)}, this is ${lead.provider.name} from Plug A Pro. I accepted your ${lead.jobRequest.category} request and would like to confirm the details.`
  )
}
