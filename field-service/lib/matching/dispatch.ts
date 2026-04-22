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

  await sendButtons(
    provider.phone,
    `🔔 *New Job Lead — ${category}*\n\nArea: *${suburb}*\n\n${jobRequest.description ?? ''}\n\nRespond by *${expiryStr}* or this lead will go to another provider.`,
    [
      { id: `accept:${hold.id}`, title: 'Accept' },
      { id: `decline:${hold.id}`, title: 'Decline' },
    ]
  ).catch((err: unknown) => {
    console.error('[dispatch] WhatsApp send failed — hold still active', {
      holdId: hold.id,
      providerId: provider.id,
      error: err,
    })
  })
}
