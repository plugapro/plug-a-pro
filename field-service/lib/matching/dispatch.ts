// ─── Match Dispatch ───────────────────────────────────────────────────────────
// Creates the Lead record and sends the WhatsApp notification after a provider
// has been atomically reserved. WhatsApp failure is non-fatal — the hold
// remains active and the provider can still be notified by retry.

import { db } from '@/lib/db'
import { getProviderLeadAccessUrl } from '@/lib/provider-lead-access'
import { sendButtons, sendCtaUrl } from '@/lib/whatsapp-interactive'
import type { CandidatePoolEntry } from './candidate-pool'
import type { MatchingJobRequest } from './types'

type AssignmentHold = { id: string; expiresAt: Date }

export async function dispatchMatchLead(params: {
  jobRequest: MatchingJobRequest & { address?: { suburb?: string | null } | null }
  hold: AssignmentHold
  provider: CandidatePoolEntry
}): Promise<void> {
  const { jobRequest, hold, provider } = params

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
    },
    update: {
      status: 'SENT',
      sentAt: new Date(),
      expiresAt: hold.expiresAt,
      assignmentHoldId: hold.id,
    },
  })

  // WhatsApp lead notification — non-blocking, failure does not roll back hold
  const suburb = jobRequest.address?.suburb ?? 'your area'
  const category = jobRequest.category
  const expiryStr = hold.expiresAt.toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  })
  const titleLine = jobRequest.title ? `*${jobRequest.title}*\n` : ''
  const body = `🔔 *New Job Lead — ${category}*\n\n${titleLine}Area: *${suburb}*\n\n${jobRequest.description ?? ''}\n\nRespond by *${expiryStr}* or this lead will go to another provider.`
  const actionsBody = `Quick response for *${category}* in *${suburb}*.`
  const msgMeta = { jobRequestId: jobRequest.id, holdId: hold.id, providerId: provider.id }
  const leadUrl = await getProviderLeadAccessUrl({
    leadId: lead.id,
    providerId: provider.id,
  })

  if (!leadUrl) {
    console.error('[dispatch] Missing provider lead URL — hold still active', msgMeta)
    await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: 'dispatch:job_lead',
        body,
        to: provider.phone,
        status: 'FAILED',
        sentAt: new Date(),
        failureReason: 'Missing provider lead access URL',
        metadata: msgMeta as object,
      },
    }).catch(() => {})
  } else {
    await sendCtaUrl(
      provider.phone,
      body,
      'View Lead',
      leadUrl,
      { footer: 'Accept, inspect, or decline from the lead page' },
      { templateName: 'dispatch:job_lead', metadata: msgMeta }
    ).catch(async (err: unknown) => {
      const failureReason = err instanceof Error ? err.message : String(err)
      console.error('[dispatch] WhatsApp send failed — hold still active', {
        ...msgMeta,
        error: failureReason,
      })
      // Record the failure in message_events so ops can see and retry
      await db.messageEvent.create({
        data: {
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          templateName: 'dispatch:job_lead',
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

  await sendButtons(
    provider.phone,
    actionsBody,
    [
      { id: `accept:${hold.id}`, title: 'Accept' },
      { id: `decline:${hold.id}`, title: 'Decline' },
    ],
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
