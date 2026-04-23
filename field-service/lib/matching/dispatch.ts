// ─── Match Dispatch ───────────────────────────────────────────────────────────
// Creates the Lead record and sends the WhatsApp notification after a provider
// has been atomically reserved. WhatsApp failure is non-fatal — the hold
// remains active and the provider can still be notified by retry.

import { db } from '@/lib/db'
import { sendButtons } from '@/lib/whatsapp-interactive'
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
  await db.lead.upsert({
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
  const body = `🔔 *New Job Lead — ${category}*\n\nArea: *${suburb}*\n\n${jobRequest.description ?? ''}\n\nRespond by *${expiryStr}* or this lead will go to another provider.`
  const msgMeta = { jobRequestId: jobRequest.id, holdId: hold.id, providerId: provider.id }

  await sendButtons(
    provider.phone,
    body,
    [
      { id: `accept:${hold.id}`, title: 'Accept' },
      { id: `decline:${hold.id}`, title: 'Decline' },
    ],
    undefined,
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
