// ─── Match Dispatch ───────────────────────────────────────────────────────────
// Creates the Lead record and sends the WhatsApp notification after a provider
// has been atomically reserved. WhatsApp failure is non-fatal — the hold
// remains active and the provider can still be notified by retry.

import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { hasSuccessfulMessageForRecipient } from '@/lib/message-events'
import { getProviderLeadAccessUrl } from '@/lib/provider-lead-access'
import { getProviderWalletBalanceReadOnly } from '@/lib/provider-wallet'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import { notifyProviderZeroBalanceLeadAvailable } from '@/lib/provider-wallet-notifications'
import {
  buildProviderLeadActionsMessage,
  buildProviderLeadPreviewMessage,
} from '@/lib/provider-credit-copy'
import { sendButtons } from '@/lib/whatsapp-interactive'
import { sendJobOffer } from '@/lib/whatsapp'
import { MATCHING_CONFIG } from './config'
import type { CandidatePoolEntry } from './candidate-pool'
import type { MatchingJobRequest } from './types'

type AssignmentHold = { id: string; expiresAt: Date }

function providerFirstName(provider: CandidatePoolEntry): string {
  return provider.name?.trim().split(/\s+/)[0] || 'there'
}

async function resolveProviderRecipientIsTest(provider: CandidatePoolEntry): Promise<boolean> {
  if (typeof provider.isTestUser === 'boolean') return provider.isTestUser

  const row = await (db as any).provider?.findUnique?.({
    where: { id: provider.id },
    select: { isTestUser: true },
  }).catch(() => null) as { isTestUser?: boolean } | null

  return Boolean(row?.isTestUser)
}

export async function dispatchMatchLead(params: {
  jobRequest: MatchingJobRequest & { address?: { suburb?: string | null } | null }
  hold: AssignmentHold
  provider: CandidatePoolEntry
}): Promise<void> {
  const { jobRequest, hold, provider } = params

  // Guard: do not re-activate a lead that the provider has already explicitly declined
  const existingLead = await db.lead.findUnique({
    where: { jobRequestId_providerId: { jobRequestId: jobRequest.id, providerId: provider.id } },
    select: { id: true, status: true },
  })
  if (existingLead?.status === 'DECLINED') {
    console.warn('[dispatch] Skipping lead dispatch — provider already declined this job', {
      jobRequestId: jobRequest.id,
      providerId: provider.id,
      leadId: existingLead.id,
    })
    return
  }

  // Create Lead record — upsert to handle idempotent re-dispatch
  const lead = await db.lead.upsert({
    where: { jobRequestId_providerId: { jobRequestId: jobRequest.id, providerId: provider.id } },
    create: {
      jobRequestId: jobRequest.id,
      providerId: provider.id,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: new Date(),
      expiresAt: hold.expiresAt,
      isTestLead: jobRequest.isTestRequest ?? false,
      cohortName: jobRequest.cohortName ?? null,
    },
    update: {
      status: 'SENT',
      sentAt: new Date(),
      expiresAt: hold.expiresAt,
      assignmentHoldId: hold.id,
      isTestLead: jobRequest.isTestRequest ?? false,
      cohortName: jobRequest.cohortName ?? null,
    },
  })

  // WhatsApp lead notification — non-blocking, failure does not roll back hold
  const suburb = normaliseLocationDisplayName(jobRequest.address?.suburb) || 'your area'
  const category = jobRequest.category
  const expiryStr = hold.expiresAt.toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  })
  const preferredTime = jobRequest.requestedWindowStart
    ? jobRequest.requestedWindowStart.toLocaleString('en-ZA', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Johannesburg',
      })
    : jobRequest.requestedArrivalLatest
      ? `Before ${jobRequest.requestedArrivalLatest.toLocaleString('en-ZA', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Johannesburg',
        })}`
      : 'Flexible'
  const [balance, previewAttachmentsCount] = await Promise.all([
    getProviderWalletBalanceReadOnly(provider.id),
    // Count only attachments flagged as safe for preview — protected docs stay hidden.
    db.attachment.count({
      where: { jobRequestId: jobRequest.id, safeForPreview: true },
    }).catch(() => null as number | null),
  ])
  const body = buildProviderLeadPreviewMessage({
    category,
    area: suburb,
    preferredTime,
    deadlineTime: expiryStr,
    balance,
    title: jobRequest.title,
    description: jobRequest.description,
    subcategory: jobRequest.subcategory,
    urgency: jobRequest.urgency,
    matchingPreference: jobRequest.providerPreference ?? jobRequest.budgetPreference,
    photosCount: previewAttachmentsCount,
    responseWindowMinutes: MATCHING_CONFIG.offerTtlMinutes,
  })
  const actionsBody = buildProviderLeadActionsMessage({ category, area: suburb, balance })
  const recipientIsTest = await resolveProviderRecipientIsTest(provider)
  const msgMeta = {
    jobRequestId: jobRequest.id,
    leadId: lead.id,
    holdId: hold.id,
    providerId: provider.id,
    isTestLead: lead.isTestLead,
    isTestRequest: jobRequest.isTestRequest ?? false,
    recipientIsTest,
  }
  const leadUrl = await getProviderLeadAccessUrl({
    leadId: lead.id,
    providerId: provider.id,
  })

  notifyProviderZeroBalanceLeadAvailable({
    providerId: provider.id,
    leadId: lead.id,
    jobRequestId: jobRequest.id,
    holdId: hold.id,
  }).catch((error: unknown) => {
    console.error('[dispatch] zero-balance lead WhatsApp notification failed', {
      jobRequestId: jobRequest.id,
      leadId: lead.id,
      providerId: provider.id,
      error,
    })
  })

  const ctaAlreadySent = await hasSuccessfulMessageForRecipient({
    to: provider.phone,
    templateName: 'provider_lead_offer',
    metadataPath: ['jobRequestId'],
    metadataEquals: jobRequest.id,
  })
  const actionsAlreadySent = await hasSuccessfulMessageForRecipient({
    to: provider.phone,
    templateName: 'dispatch:job_lead_actions',
    metadataPath: ['jobRequestId'],
    metadataEquals: jobRequest.id,
  })

  if (!leadUrl) {
    console.error('[dispatch] Missing provider lead URL — hold still active', msgMeta)
    if (!ctaAlreadySent) await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: 'provider_lead_offer',
        body,
        to: provider.phone,
        status: 'FAILED',
        sentAt: new Date(),
        failureReason: 'Missing provider lead access URL',
        metadata: msgMeta as object,
      },
    }).catch(() => {})
  } else if (!ctaAlreadySent) {
    await sendJobOffer({
      providerPhone: provider.phone,
      providerFirstName: providerFirstName(provider),
      serviceName: category,
      area: suburb,
      scheduledWindow: preferredTime,
      jobUrl: leadUrl,
      metadata: msgMeta,
    }).catch(async (err: unknown) => {
      const failureReason = err instanceof Error ? err.message : String(err)
      console.error('[dispatch] WhatsApp template send failed — hold still active', {
        ...msgMeta,
        error: failureReason,
      })
      // Record the failure in message_events so ops can see and retry
      await db.messageEvent.create({
        data: {
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          templateName: 'provider_lead_offer',
          body,
          to: provider.phone,
          status: 'FAILED',
          sentAt: new Date(),
          failureReason,
          metadata: msgMeta as object,
        },
      }).catch(() => {})
    })
  }

  if (actionsAlreadySent) return

  // Qualified Shortlist Model: when the dispatch_v2 flag is on, the buttons
  // capture free interest instead of triggering a paid acceptance. This keeps
  // the legacy paid sequential dispatch reachable until pilots are ready.
  const dispatchV2 = await isEnabled('qualified_shortlist.dispatch_v2').catch(() => false)
  const buttons = dispatchV2
    ? [
        { id: `interested:${lead.id}`, title: "I'm available" },
        { id: `not_interested:${lead.id}`, title: 'Not available' },
      ]
    : [
        { id: `accept:${hold.id}`, title: 'Accept Lead' },
        { id: `decline:${hold.id}`, title: 'Decline' },
      ]

  await sendButtons(
    provider.phone,
    actionsBody,
    buttons,
    undefined,
    { templateName: 'dispatch:job_lead_actions', metadata: msgMeta }
  ).catch(async (err: unknown) => {
    const failureReason = err instanceof Error ? err.message : String(err)
    console.error('[dispatch] WhatsApp action buttons failed — hold still active', {
      ...msgMeta,
      error: failureReason,
    })
    await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: 'dispatch:job_lead_actions',
        body: actionsBody,
        to: provider.phone,
        status: 'FAILED',
        sentAt: new Date(),
        failureReason,
        metadata: msgMeta as object,
      },
    }).catch(() => {})
  })
}
