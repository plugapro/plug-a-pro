import type { Prisma } from '@prisma/client'
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
import { testEventFields } from './internal-test-cohort'
import { ctaLabelFor } from './whatsapp-copy'

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
  try {
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
  } catch (err) {
    // Treat lookup failures as "not sent yet" so we proceed with the notification
    // attempt rather than crashing the whole post-match flow.
    console.warn('[post-match] hasSentPostMatchMessage lookup failed (proceeding as not-sent)', {
      to: params.to,
      templateName: params.templateName,
      leadId: params.leadId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

async function recordPostMatchSendFailure(params: {
  to: string
  templateName: string
  leadId: string
  jobRequestId: string
  providerId: string
  customerId?: string | null
  reason: string
  body?: string
  metadata?: Record<string, unknown>
  isTestEvent?: boolean
}) {
  try {
    const metadata = {
      ...params.metadata,
      leadId: params.leadId,
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      source: 'post_match_communications',
    }
    await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: params.templateName,
        body: params.body,
        to: params.to,
        status: 'FAILED',
        sentAt: new Date(),
        failureReason: params.reason,
        customerId: params.customerId ?? undefined,
        metadata: metadata as Prisma.InputJsonValue,
        ...testEventFields(Boolean(params.isTestEvent)),
      },
    })
  } catch (err) {
    console.warn('[post-match] failed to record FAILED MessageEvent (non-fatal)', {
      to: params.to,
      templateName: params.templateName,
      leadId: params.leadId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function notifyPostMatchAcceptance(params: {
  leadId: string
  providerId: string
  matchId: string
  creditTransactionId?: string | null
}): Promise<{ providerNotified: boolean; customerNotified: boolean }> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: {
      provider: { select: { id: true, name: true, phone: true, isTestUser: true } },
      unlock: { select: { id: true, creditsCharged: true, unlockedAt: true } },
      jobRequest: {
        include: {
          customer: { select: { id: true, name: true, phone: true, isTestUser: true } },
          address: { select: { street: true, suburb: true, city: true, province: true } },
          match: { select: { id: true, providerId: true, status: true, createdAt: true } },
        },
      },
    },
  })

  if (!lead || lead.providerId !== params.providerId) {
    return { providerNotified: false, customerNotified: false }
  }

  const customer = lead.jobRequest.customer
  const provider = lead.provider
  const isTestLead = Boolean((lead as { isTestLead?: boolean }).isTestLead)
  const ref = lead.jobRequest.id.slice(-8).toUpperCase()
  const customerName = firstName(customer.name)
  const category = lead.jobRequest.category
  const address = addressLabel(lead.jobRequest.address)

  // Non-throwing URL lookups — null means we fall back to plain text messages.
  const leadUrl = await getProviderSignedJobHandoverUrlByLeadId(lead.id).catch(() => null)
  const customerHandoverUrl = await getCustomerProviderHandoverUrl({
    leadId: lead.id,
    providerId: provider.id,
    jobRequestId: lead.jobRequestId,
  }).catch(() => null)

  const preferredAvailability = preferredAvailabilityLabel(lead.jobRequest)
  const creditsCharged = lead.unlock?.creditsCharged ?? 1
  const walletBalance = await getProviderWalletBalanceReadOnly(provider.id).catch((err) => {
    console.error('[post-match] provider wallet balance lookup failed (non-fatal)', {
      lead_id: lead.id,
      provider_id: provider.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      providerId: provider.id,
      paidCreditBalance: 0,
      promoCreditBalance: 0,
      totalCreditBalance: 0,
      status: 'UNKNOWN',
    }
  })

  const { sendText, sendCtaUrl, sendButtons } = await import('./whatsapp-interactive')

  let customerNotified = false
  let providerNotified = false

  // Customer notification — non-fatal. A customer-side WhatsApp failure must
  // never block the provider confirmation that follows.
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
        recipientIsTest: customer.isTestUser,
      },
    }

    try {
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
      customerNotified = true
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[post-match] customer notification failed (non-fatal — provider confirmation continues)', {
        lead_id: lead.id,
        customer_id: customer.id,
        error: reason,
      })
      await recordPostMatchSendFailure({
        to: customer.phone,
        templateName: 'post_match_customer_provider_accepted',
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        providerId: provider.id,
        customerId: customer.id,
        reason,
        body: customerBody,
        metadata: customerContext.metadata,
        isTestEvent: isTestLead,
      })
    }
  }

  // Provider notification — must always be attempted regardless of customer outcome.
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

    const providerContext = {
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
        recipientIsTest: provider.isTestUser,
      },
    }

    try {
      if (leadUrl) {
        await sendCtaUrl(
          provider.phone,
          body,
          ctaLabelFor('view_job'),
          leadUrl,
          { footer: 'Secure link for this accepted job only.' },
          providerContext,
        )
      } else {
        await sendText(provider.phone, body, providerContext)
      }
      // Mark as notified here — before the Contact Customer button — so that a
      // failure on the secondary button does not incorrectly mark providerNotified false.
      providerNotified = true
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error('[post-match] provider confirmation failed', {
        lead_id: lead.id,
        provider_id: provider.id,
        error: reason,
      })
      await recordPostMatchSendFailure({
        to: provider.phone,
        templateName: 'post_match_provider_job_accepted',
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        providerId: provider.id,
        reason,
        body,
        metadata: providerContext.metadata,
        isTestEvent: isTestLead,
      })
    }
  }

  // Contact Customer button — non-fatal; failure must not affect providerNotified.
  if (provider.phone && !(await hasSentPostMatchMessage({
    to: provider.phone,
    templateName: 'post_match_provider_next_actions',
    leadId: lead.id,
  }))) {
    try {
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
            recipientIsTest: provider.isTestUser,
          },
        },
      )
    } catch (err) {
      console.error('[post-match] contact-customer button failed (non-fatal)', {
        lead_id: lead.id,
        provider_id: provider.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.info('[post-match] accepted lead handover notifications processed', {
    lead_id: lead.id,
    job_request_id: lead.jobRequestId,
    match_id: params.matchId,
    provider_id: provider.id,
    customer_id: customer.id,
    credit_transaction_id: params.creditTransactionId ?? null,
    lead_unlock_id: lead.unlock?.id ?? null,
    customer_notified: customerNotified,
    provider_notified: providerNotified,
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

  return { providerNotified, customerNotified }
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
  if (resolved.lead.status !== 'ACCEPTED' && resolved.lead.status !== 'ACCEPTED_LOCKED') return null

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

  if (!lead || lead.provider.phone !== params.providerPhone || (lead.status !== 'ACCEPTED' && lead.status !== 'ACCEPTED_LOCKED')) {
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
