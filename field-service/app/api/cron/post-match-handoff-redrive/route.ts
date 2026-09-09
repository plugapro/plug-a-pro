// ─── Cron: redrive post-match handoff notifications ──────────────────────────
//
// Safety net for the handoff that turns an accepted lead into a real job. When
// a provider accepts, notifyPostMatchAcceptance() releases the customer's
// contact details and sends the provider their job-page link. Without that
// message the provider has accepted a job they cannot act on, and the customer
// waits for a call that never comes.
//
// It was dropped silently for two months: the notification was fired as a
// floating promise, which Vercel abandons when the function suspends after the
// response. Four providers accepted, none were told what to do next, and not
// one quote was ever created. lib/run-after-response.ts fixes the delivery
// path; this cron makes it recoverable, so a future failure of ANY cause —
// a throw, a timeout, a WhatsApp outage — self-heals instead of stranding a
// customer in silence.
//
// notifyPostMatchAcceptance is idempotent (it checks message_events before
// each send), so re-running is safe.
//
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).
// Flag-gated by `provider.post_match_handoff.redrive`.

import { NextResponse } from 'next/server'
import { MessageStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { notifyPostMatchAcceptance } from '@/lib/post-match-communications'

const FLAG = 'provider.post_match_handoff.redrive'

// Templates that mean "the provider was told what to do next". Any one of them
// having landed is proof the handoff completed.
const HANDOFF_TEMPLATES = [
  'provider_job_accepted_next_steps',
  'post_match_provider_job_accepted',
]
const DELIVERED_STATUSES: MessageStatus[] = [
  MessageStatus.SENT,
  MessageStatus.DELIVERED,
  MessageStatus.READ,
]

// Give the live path time to land before retrying, and refuse to wake up
// acceptances so old that a message would confuse rather than help.
const MIN_AGE_MINUTES = 10
const MAX_AGE_HOURS = 48
const MAX_BATCH = 25

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronName = 'post-match-handoff-redrive'
  const cronStart = Date.now()

  if (!(await isEnabled(FLAG))) {
    return NextResponse.json({ ok: true, skipped: 0, redriven: 0, disabled: true })
  }

  const now = Date.now()
  const candidates = await db.lead.findMany({
    where: {
      providerAcceptedAt: {
        gte: new Date(now - MAX_AGE_HOURS * 3_600_000),
        lte: new Date(now - MIN_AGE_MINUTES * 60_000),
      },
      isTestLead: false,
    },
    select: { id: true, providerId: true, jobRequestId: true, providerAcceptedAt: true },
    orderBy: { providerAcceptedAt: 'asc' },
    take: MAX_BATCH,
  })

  let redriven = 0
  let alreadyHandled = 0
  let failed = 0

  for (const lead of candidates) {
    const delivered = await db.messageEvent.findFirst({
      where: {
        leadId: lead.id,
        templateName: { in: HANDOFF_TEMPLATES },
        status: { in: DELIVERED_STATUSES },
      },
      select: { id: true },
    })

    if (delivered) {
      alreadyHandled += 1
      continue
    }

    try {
      const result = await notifyPostMatchAcceptance({
        leadId: lead.id,
        providerId: lead.providerId,
      })
      redriven += 1
      console.warn('[post-match-handoff-redrive] recovered a stranded acceptance', {
        cron: cronName,
        lead_id: lead.id,
        provider_id: lead.providerId,
        job_request_id: lead.jobRequestId,
        accepted_at: lead.providerAcceptedAt?.toISOString() ?? null,
        provider_notified: result.providerNotified,
        customer_notified: result.customerNotified,
      })
    } catch (error) {
      failed += 1
      console.error('[post-match-handoff-redrive] redrive failed', {
        cron: cronName,
        lead_id: lead.id,
        provider_id: lead.providerId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const body = {
    ok: true,
    scanned: candidates.length,
    redriven,
    alreadyHandled,
    failed,
    durationMs: Date.now() - cronStart,
  }
  console.info('[post-match-handoff-redrive] complete', { cron: cronName, ...body })
  return NextResponse.json(body)
}
