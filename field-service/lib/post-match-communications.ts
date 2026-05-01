import { db } from './db'
import { recordAuditLog } from './audit'
import { AUDIT_ENTITY } from './audit-entities'
import { getCustomerProviderHandoverUrl } from './customer-provider-handover-access'
import {
  getProviderSignedJobHandoverUrlByLeadId,
  providerLeadTokenAllowsScope,
  verifyProviderLeadAccessToken,
} from './provider-lead-access'
import { getProviderWalletBalanceReadOnly } from './provider-wallet'
import { normaliseLocationDisplayName } from './location-format'
import { buildLeadAcceptedCreditLine } from './provider-credit-copy'

const SENT_OR_BETTER = ['SENT', 'DELIVERED', 'READ'] as const

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function providerDisplayName(providerName: string | null | undefined) {
  const name = providerName?.trim()
  return name ? `${name} from Plug A Pro` : 'Your Plug A Pro provider'
}

function addressLabel(address: { street?: string | null; suburb?: string | null; city?: string | null; province?: string | null } | null | undefined) {
  return [
    address?.street,
    normaliseLocationDisplayName(address?.suburb),
    normaliseLocationDisplayName(address?.city),
    normaliseLocationDisplayName(address?.province),
  ].filter(Boolean).join(', ') || 'View the signed job link for the address'
}

function preferredAvailabilityLabel(jobRequest: {
  requestedWindowStart?: Date | null
  requestedWindowEnd?: Date | null
  requestedArrivalLatest?: Date | null
}) {
  const dateTime = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const timeOnly = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
  })

  if (jobRequest.requestedWindowStart) {
    const start = dateTime.format(jobRequest.requestedWindowStart)
    const end = jobRequest.requestedWindowEnd ? timeOnly.format(jobRequest.requestedWindowEnd) : null
    return end ? `${start}-${end}` : start
  }
  if (jobRequest.requestedArrivalLatest) {
    return `Before ${dateTime.format(jobRequest.requestedArrivalLatest)}`
  }
  return 'Flexible'
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
  creditTransactionId?: string | null
}) {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: {
      provider: { select: { id: true, name: true, phone: true } },
      unlock: { select: { id: true, creditsCharged: true, unlockedAt: true } },
      jobRequest: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: { select: { street: true, suburb: true, city: true, province: true } },
          match: { select: { id: true, providerId: true, status: true, createdAt: true } },
        },
      },
    },
  })

  if (!lead || lead.providerId !== params.providerId) return

  const customer = lead.jobRequest.customer
  const provider = lead.provider
  const isTestLead = Boolean((lead as { isTestLead?: boolean }).isTestLead)
  const ref = lead.jobRequest.id.slice(-8).toUpperCase()
  const customerName = firstName(customer.name)
  const category = lead.jobRequest.category
  const address = addressLabel(lead.jobRequest.address)
  const leadUrl = await getProviderSignedJobHandoverUrlByLeadId(lead.id)
  const customerHandoverUrl = await getCustomerProviderHandoverUrl({
    leadId: lead.id,
    providerId: provider.id,
    jobRequestId: lead.jobRequestId,
  })
  const preferredAvailability = preferredAvailabilityLabel(lead.jobRequest)
  const creditsCharged = lead.unlock?.creditsCharged ?? 1
  const walletBalance = await getProviderWalletBalanceReadOnly(provider.id)

  const { sendText, sendCtaUrl, sendButtons } = await import('./whatsapp-interactive')

  if (customer.phone && !(await hasSentPostMatchMessage({
    to: customer.phone,
    templateName: 'post_match_customer_provider_accepted',
    leadId: lead.id,
  }))) {
    const customerBody =
      `🎉 *Great news, ${customerName}!*\n\n` +
      `*${providerDisplayName(provider.name)}* has accepted your *${category}* request.\n\n` +
      `They will contact you shortly to confirm the visit details.\n\n` +
      `Provider contact:\n${provider.phone}\n\n` +
      `Ref: *${ref}*`
    const customerContext = {
      templateName: 'post_match_customer_provider_accepted',
      metadata: {
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        matchId: params.matchId,
        providerId: provider.id,
        customerId: customer.id,
        handoverUrlCreated: Boolean(customerHandoverUrl),
        isTestLead,
        isTestRequest: isTestLead,
      },
    }

    if (customerHandoverUrl) {
      await sendCtaUrl(
        customer.phone,
        customerBody,
        'View Provider',
        customerHandoverUrl,
        { footer: 'Secure link for this request only.' },
        customerContext,
      )
    } else {
      await sendText(customer.phone, customerBody, customerContext)
    }
  }

  if (provider.phone && !(await hasSentPostMatchMessage({
    to: provider.phone,
    templateName: 'post_match_provider_job_accepted',
    leadId: lead.id,
  }))) {
    const body =
      `✅ *Lead accepted — ${firstName(provider.name)}*\n\n` +
      `${buildLeadAcceptedCreditLine({
        creditsUsed: creditsCharged,
        remainingCredits: walletBalance.totalCreditBalance,
        starterCredits: walletBalance.promoCreditBalance,
        paidCredits: walletBalance.paidCreditBalance,
      })}\n\n` +
      `Full customer and job details are now available.\n\n` +
      `Client: *${customer.name}*\n` +
      `Service: *${category}*\n` +
      `Address: *${address}*\n` +
      `Preferred availability: *${preferredAvailability}*\n` +
      `Ref: *${ref}*\n\n` +
      `Customer contact:\n${customer.name}\n${customer.phone}\n\n` +
      `You can manage this job from the link below. No login is needed for this job link.`

    if (leadUrl) {
      await sendCtaUrl(
        provider.phone,
        body,
        'View Job',
        leadUrl,
        { footer: 'Secure link for this accepted job only.' },
        {
          templateName: 'post_match_provider_job_accepted',
          metadata: {
            leadId: lead.id,
            jobRequestId: lead.jobRequestId,
            matchId: params.matchId,
            providerId: provider.id,
            leadUnlockId: lead.unlock?.id,
            creditTransactionId: params.creditTransactionId ?? null,
            customerContactReleased: true,
            isTestLead,
            isTestRequest: isTestLead,
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
          leadUnlockId: lead.unlock?.id,
          creditTransactionId: params.creditTransactionId ?? null,
          customerContactReleased: true,
          isTestLead,
          isTestRequest: isTestLead,
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
      `Customer contact is released for this accepted job. Tap below to open WhatsApp with ${customerName}.`,
      [{ id: `post_match_contact:${lead.id}`, title: 'Contact Customer' }],
      { footer: 'This contact handover is logged on the ticket.' },
      {
        templateName: 'post_match_provider_next_actions',
        metadata: {
          leadId: lead.id,
          jobRequestId: lead.jobRequestId,
          matchId: params.matchId,
          providerId: provider.id,
          leadUnlockId: lead.unlock?.id,
          creditTransactionId: params.creditTransactionId ?? null,
          isTestLead,
          isTestRequest: isTestLead,
        },
      },
    )
  }

  console.info('[post-match] accepted lead handover notifications processed', {
    lead_id: lead.id,
    job_request_id: lead.jobRequestId,
    match_id: params.matchId,
    provider_id: provider.id,
    customer_id: customer.id,
    credit_transaction_id: params.creditTransactionId ?? null,
    lead_unlock_id: lead.unlock?.id ?? null,
    customer_notification_result: customer.phone ? 'attempted' : 'skipped_no_phone',
    provider_notification_result: provider.phone ? 'attempted' : 'skipped_no_phone',
    signed_link_generation_result: {
      provider_view_job: Boolean(leadUrl),
      customer_view_provider: Boolean(customerHandoverUrl),
    },
    trace_id: `handover_${lead.id}_${params.matchId}`,
  })

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
  const verified = verifyProviderLeadAccessToken(params.token)
  if (
    verified.status !== 'active' ||
    !providerLeadTokenAllowsScope(verified.payload, 'contact_customer')
  ) {
    return null
  }

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
