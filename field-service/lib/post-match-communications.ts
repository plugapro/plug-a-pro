import type { Prisma } from '@prisma/client'
import { db } from './db'
import { recordAuditLog } from './audit'
import { AUDIT_ENTITY } from './audit-entities'
import { recordWorkflowEvent } from './workflow-events/record'
import { getCustomerProviderHandoverUrl } from './customer-provider-handover-access'
import { logOutboundMessage } from './message-events'
import {
  getProviderSignedJobHandoverUrlByLeadId,
  verifyProviderLeadAccessToken,
} from './provider-lead-access'
import { getProviderWalletBalanceReadOnly } from './provider-wallet'
import { normaliseLocationDisplayName } from './location-format'
import { buildLeadAcceptedCreditLine } from './provider-credit-copy'
import { testEventFields } from './internal-test-cohort'
import { pickCustomerDisplayFirstName } from './customer-name'
import {
  buildCustomerMatchFoundComponents,
  sendProviderJobAcceptedNextSteps,
  sendTemplate,
} from './whatsapp'
import { ctaLabelFor } from './whatsapp-copy'
import {
  hasRecentInboundWhatsappSession,
  isTemplateNotApprovedError,
} from './whatsapp-policy'

const SENT_OR_BETTER = ['SENT', 'DELIVERED', 'READ'] as const

function firstName(name: string | null | undefined) {
  // Placeholder-aware: WhatsApp-onboarded customers carry the literal name
  // "WhatsApp Customer"; the raw first token would greet them "Hi WhatsApp".
  return pickCustomerDisplayFirstName({ customerName: name ?? null }) ?? 'there'
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
  templateNames: string[]
  leadId: string
}) {
  try {
    const existing = await db.messageEvent.findFirst({
      where: {
        to: params.to,
        templateName: { in: params.templateNames },
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
      templateNames: params.templateNames,
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

type CustomerDeliveryOutcome =
  | 'primary_template_sent'
  | 'fallback_template_sent'
  | 'inside_window_text_sent'
  | 'outside_window_blocked'
  | 'send_error'

type CustomerDeliveryResult = {
  sent: boolean
  outcome: CustomerDeliveryOutcome
  failureReason?: string
}

async function deliverCustomerPostMatchNotification(params: {
  customerPhone: string
  customerName: string
  providerFirstName: string
  providerPhone: string
  category: string
  jobRequestId: string
  customerBody: string
  customerHandoverUrl: string | null
  customerContext: {
    templateName: string
    metadata: Record<string, unknown>
  }
  isTestLead: boolean
}): Promise<CustomerDeliveryResult> {
  const {
    customerPhone,
    customerName,
    providerFirstName,
    providerPhone,
    category,
    jobRequestId,
    customerBody,
    customerHandoverUrl,
    customerContext,
    isTestLead,
  } = params

  // ── Step 1: preferred template (named provider + PWA deep-link) ──────────
  try {
    const externalId = await sendTemplate({
      to: customerPhone,
      template: 'post_match_customer_provider_accepted',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customerName },
            { type: 'text', text: providerFirstName },
            { type: 'text', text: category },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: jobRequestId }],
        },
      ],
      metadata: { ...customerContext.metadata, deliveryPath: 'primary_template' },
    })
    await logOutboundMessage({
      to: customerPhone,
      templateName: 'post_match_customer_provider_accepted',
      body: customerBody,
      externalId,
      metadata: { ...customerContext.metadata, deliveryPath: 'primary_template' },
      isTestEvent: isTestLead,
    }).catch((err: unknown) => {
      console.warn('[post-match] logOutboundMessage (primary_template) failed (non-fatal)', {
        leadId: customerContext.metadata.leadId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    return { sent: true, outcome: 'primary_template_sent' }
  } catch (primaryErr) {
    if (!isTemplateNotApprovedError(primaryErr)) {
      return {
        sent: false,
        outcome: 'send_error',
        failureReason: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      }
    }
    console.info('[post-match] primary post-match template not approved, trying fallback template', {
      leadId: customerContext.metadata.leadId,
    })
  }

  // ── Step 2: approved fallback template (customer_match_found) ────────────
  try {
    const externalId = await sendTemplate({
      to: customerPhone,
      template: 'customer_match_found',
      components: buildCustomerMatchFoundComponents({
        customerFirstName: customerName,
        serviceName: category,
        providerFirstName,
        jobRequestId,
      }),
      metadata: { ...customerContext.metadata, deliveryPath: 'fallback_template' },
    })
    await logOutboundMessage({
      to: customerPhone,
      templateName: 'customer_match_found',
      body: customerBody,
      externalId,
      metadata: { ...customerContext.metadata, deliveryPath: 'fallback_template' },
      isTestEvent: isTestLead,
    }).catch((err: unknown) => {
      console.warn('[post-match] logOutboundMessage (fallback_template) failed (non-fatal)', {
        leadId: customerContext.metadata.leadId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    return { sent: true, outcome: 'fallback_template_sent' }
  } catch (fallbackErr) {
    if (!isTemplateNotApprovedError(fallbackErr)) {
      return {
        sent: false,
        outcome: 'send_error',
        failureReason: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      }
    }
  }

  // ── Step 3: 24h-window-gated rich CTA (only inside the customer-service window) ──
  const hasWindow = await hasRecentInboundWhatsappSession(customerPhone).catch(() => false)
  if (!hasWindow) {
    return {
      sent: false,
      outcome: 'outside_window_blocked',
      failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
    }
  }

  const { sendText, sendCtaUrl } = await import('./whatsapp-interactive')
  try {
    if (customerHandoverUrl) {
      const whatsappProviderUrl = `https://wa.me/${providerPhone.replace(/\D/g, '')}`
      await sendCtaUrl(
        customerPhone,
        customerBody,
        'WhatsApp Provider',
        whatsappProviderUrl,
        { footer: 'Chat directly with your provider.' },
        customerContext,
      )
    } else {
      await sendText(customerPhone, customerBody, customerContext)
    }
    return { sent: true, outcome: 'inside_window_text_sent' }
  } catch (err) {
    return {
      sent: false,
      outcome: 'send_error',
      failureReason: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function notifyPostMatchAcceptance(params: {
  leadId: string
  providerId: string
  matchId?: string | null
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

  // Non-throwing URL lookups - null means we fall back to plain text messages.
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

  // Customer notification - non-fatal. A customer-side WhatsApp failure must
  // never block the provider confirmation that follows.
  //
  // Send strategy (template-first; falls through on TEMPLATE_NOT_APPROVED):
  //   1. sendTemplate('post_match_customer_provider_accepted') - the eventual
  //      preferred template with named provider + PWA deep-link button. Until
  //      Meta approves it, step 2 carries the load.
  //   2. sendTemplate('customer_match_found') - already approved. Slightly
  //      different wording ("reviewing your request") but still tells the
  //      customer something happened with a deep-link to the PWA.
  //   3. Free-form rich CTA (sendCtaUrl/sendText) - ONLY when the customer is
  //      inside the 24h re-engagement window. This preserves the existing
  //      WhatsApp-Provider CTA experience for live conversations.
  //   4. Outside the 24h window with no approved template - we DO NOT send
  //      plain text (Meta returns "Re-engagement message"). The failure is
  //      recorded explicitly with NO_ACTIVE_WHATSAPP_SERVICE_WINDOW so ops
  //      can manually follow up.
  if (customer.phone && !(await hasSentPostMatchMessage({
    to: customer.phone,
    templateNames: ['post_match_customer_provider_accepted'],
    leadId: lead.id,
  }))) {
    const customerBody =
      `🎉 *Great news, ${customerName}!*\n\n` +
      `*${providerDisplayName(provider.name)}* has accepted your *${category}* request.\n\n` +
      `They will contact you shortly to confirm the visit details.\n\n` +
      `` +
      `Ref: *${ref}*`
    const customerContext = {
      templateName: 'post_match_customer_provider_accepted',
      metadata: {
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        matchId: params.matchId ?? null,
        providerId: provider.id,
        customerId: customer.id,
        handoverUrlCreated: Boolean(customerHandoverUrl),
        isTestLead,
        isTestRequest: isTestLead,
        recipientIsTest: customer.isTestUser,
      },
    }
    const providerFirstName = firstName(provider.name)

    const customerDelivery = await deliverCustomerPostMatchNotification({
      customerPhone: customer.phone,
      customerName,
      providerFirstName,
      providerPhone: provider.phone,
      category,
      jobRequestId: lead.jobRequestId,
      customerBody,
      customerHandoverUrl,
      customerContext,
      isTestLead,
    })

    if (customerDelivery.sent) {
      customerNotified = true
    } else {
      console.error('[post-match] customer notification failed (non-fatal - provider confirmation continues)', {
        lead_id: lead.id,
        customer_id: customer.id,
        reason: customerDelivery.failureReason,
        outcome: customerDelivery.outcome,
      })
      await recordPostMatchSendFailure({
        to: customer.phone,
        templateName: 'post_match_customer_provider_accepted',
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        providerId: provider.id,
        customerId: customer.id,
        reason: customerDelivery.failureReason ?? 'UNKNOWN',
        body: customerBody,
        metadata: { ...customerContext.metadata, outcome: customerDelivery.outcome },
        isTestEvent: isTestLead,
      })
    }
  }

  // The provider's 24h session window — reply buttons and freeform sends only
  // deliver inside it. Checked lazily and memoised so a single acceptance does
  // at most one lookup.
  let providerWindowOpen: boolean | null = null
  const providerHasSessionWindow = async () => {
    if (providerWindowOpen === null) {
      providerWindowOpen = await hasRecentInboundWhatsappSession(provider.phone).catch(() => false)
    }
    return providerWindowOpen
  }

  // Provider notification - must always be attempted regardless of customer outcome.
  //
  // Send strategy (mirrors the customer branch above):
  //   1. sendProviderJobAcceptedNextSteps — UTILITY template with the signed
  //      job link in a URL button. Works outside the 24h window.
  //   2. On TEMPLATE_NOT_APPROVED (or when no signed URL exists to satisfy the
  //      template's URL button): the legacy rich session send (sendCtaUrl /
  //      sendText) — ONLY inside the 24h window.
  //   3. Outside the window with no approved template — record the blocked
  //      state (NO_ACTIVE_WHATSAPP_SERVICE_WINDOW) instead of a doomed send.
  if (provider.phone && !(await hasSentPostMatchMessage({
    to: provider.phone,
    templateNames: ['provider_job_accepted_next_steps', 'post_match_provider_job_accepted'],
    leadId: lead.id,
  }))) {
    const body =
      `✅ *Lead accepted - ${firstName(provider.name)}*\n\n` +
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
      `Customer details:\n${customer.name}\n${customer.phone}\n\n` +
      `Next step: Reply with your arrival time. Example: *14:00*\n\n` +
      `You can manage this job from the link below. No login is needed for this job link.`

    const providerContext = {
      templateName: 'post_match_provider_job_accepted',
      metadata: {
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        matchId: params.matchId ?? null,
        providerId: provider.id,
        leadUnlockId: lead.unlock?.id,
        creditTransactionId: params.creditTransactionId ?? null,
        customerContactReleased: true,
        isTestLead,
        isTestRequest: isTestLead,
        recipientIsTest: provider.isTestUser,
      },
    }

    const providerArea = [
      normaliseLocationDisplayName(lead.jobRequest.address?.suburb),
      normaliseLocationDisplayName(lead.jobRequest.address?.city),
    ].filter(Boolean).join(', ') || 'your area'

    // ── Step 1: UTILITY template (works outside the 24h window) ────────────
    let providerTemplateNotApproved = false
    if (leadUrl) {
      try {
        await sendProviderJobAcceptedNextSteps({
          to: provider.phone,
          firstName: firstName(provider.name),
          service: category,
          area: providerArea,
          jobUrl: leadUrl,
          metadata: { ...providerContext.metadata, deliveryPath: 'primary_template' },
        })
        providerNotified = true
      } catch (err) {
        if (isTemplateNotApprovedError(err)) {
          providerTemplateNotApproved = true
          console.info('[post-match] provider job-accepted template not approved, trying session path', {
            lead_id: lead.id,
            provider_id: provider.id,
          })
        } else {
          const reason = err instanceof Error ? err.message : String(err)
          console.error('[post-match] provider confirmation failed', {
            lead_id: lead.id,
            provider_id: provider.id,
            error: reason,
          })
          await recordPostMatchSendFailure({
            to: provider.phone,
            templateName: 'provider_job_accepted_next_steps',
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
    }

    // ── Step 2: 24h-window-gated session send (legacy rich message) ────────
    if (!providerNotified && (providerTemplateNotApproved || !leadUrl)) {
      if (!(await providerHasSessionWindow())) {
        console.error('[post-match] provider confirmation blocked: template unapproved and provider outside 24h window', {
          lead_id: lead.id,
          provider_id: provider.id,
          outcome: 'outside_window_blocked',
        })
        await recordPostMatchSendFailure({
          to: provider.phone,
          templateName: 'post_match_provider_job_accepted',
          leadId: lead.id,
          jobRequestId: lead.jobRequestId,
          providerId: provider.id,
          reason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
          body,
          metadata: { ...providerContext.metadata, outcome: 'outside_window_blocked' },
          isTestEvent: isTestLead,
        })
      } else {
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
          // Mark as notified here - before the Contact Customer button - so that a
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
    }
  }

  // Contact Customer button - non-fatal; failure must not affect providerNotified.
  // Reply buttons CANNOT be templated, so this send is gated on the 24h window:
  // outside it Meta rejects with "Re-engagement message" anyway.
  if (provider.phone && !(await hasSentPostMatchMessage({
    to: provider.phone,
    templateNames: ['post_match_provider_next_actions'],
    leadId: lead.id,
  }))) {
    if (!(await providerHasSessionWindow())) {
      console.info('[post-match] skipped contact-customer buttons: reply buttons cannot be templated and provider is outside the 24h window', {
        lead_id: lead.id,
        provider_id: provider.id,
        result: 'outside_window_skipped',
      })
    } else {
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
              matchId: params.matchId ?? null,
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
  }

  console.info('[post-match] accepted lead handover notifications processed', {
    lead_id: lead.id,
    job_request_id: lead.jobRequestId,
    match_id: params.matchId ?? null,
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
    trace_id: `handover_${lead.id}_${params.matchId ?? 'shortlist'}`,
  })

  await recordAuditLog({
    actorId: provider.id,
    actorRole: 'provider',
    action: 'match.accepted.communication_started',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    after: {
      leadId: lead.id,
      matchId: params.matchId ?? null,
      providerId: provider.id,
      customerContactReleased: true,
    },
  }).catch(() => {})

  // Tier 1 funnel observability — CLIENT_NOTIFIED emit. Only fires when the
  // customer was actually reached (customerNotified=true); failed customer
  // sends leave the funnel honest about the matched-but-not-told leak.
  // Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
  if (customerNotified) {
    recordWorkflowEvent({
      eventType: 'CLIENT_NOTIFIED',
      actorType: 'system',
      entityType: 'JOB_REQUEST',
      entityId: lead.jobRequestId,
      source: 'system',
      metadata: {
        leadId: lead.id,
        matchId: params.matchId ?? null,
        providerId: provider.id,
        customerId: customer.id,
        channel: 'WHATSAPP',
        customerContactReleased: true,
      },
    }).catch(() => {})
  }

  return { providerNotified, customerNotified }
}

export async function buildAcceptedLeadContactUrl(params: {
  leadId: string
  token: string
}) {
  const { resolveProviderLeadAccessToken } = await import('./provider-lead-access')
  const verified = verifyProviderLeadAccessToken(params.token)
  if (verified.status !== 'active') {
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
