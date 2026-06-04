// ─── Cron: WhatsApp pre-expiry registration warning ──────────────────────────
// Schedule: */5 5-20 * * * (every 5 min, 07:00-22:00 SAST)
//
// For every mid-flow registration session within 6 min of expiry, send a
// "continue" WhatsApp template message before the freeform window slams shut.
// Reuses Conversation.timeoutNotifiedAt as the atomic-claim sentinel so we
// never double-warn a session that the post-expiry cron will also touch.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTemplate } from '@/lib/whatsapp'
import { isEnabled } from '@/lib/flags'
import { maskPhone } from '@/lib/support-diagnostics'

const WARN_LEAD_MS = 6 * 60 * 1000 // warn when expiresAt is within the next 6 minutes

const FLOWS_TO_WARN = ['registration'] as const

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (!(await isEnabled('whatsapp.session_prewarning'))) {
    return NextResponse.json({ skipped: 'flag_disabled' })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const now = new Date()
  const LOCK_SENTINEL = new Date(0)
  const upperBound = new Date(now.getTime() + WARN_LEAD_MS)

  // Sessions that are still ACTIVE (expiresAt in the future) but expiring soon,
  // and have not yet been notified.
  const candidates = await db.conversation.findMany({
    where: {
      flow: { in: [...FLOWS_TO_WARN] },
      expiresAt: { gt: now, lt: upperBound },
      timeoutNotifiedAt: null,
    },
    select: { id: true, phone: true, flow: true, step: true, data: true },
  })

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const conv of candidates) {
    try {
      // Atomic claim: only one cron invocation wins per session.
      const claimed = await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: null },
        data: { timeoutNotifiedAt: LOCK_SENTINEL },
      })
      if (claimed.count === 0) {
        skipped++
        continue
      }

      const firstName = resolveFirstName(conv.data)

      await sendTemplate({
        to: conv.phone,
        template: 'provider_registration_continue',
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: firstName }],
          },
        ],
      })

      await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: LOCK_SENTINEL },
        data: { timeoutNotifiedAt: now },
      })

      sent++
      console.log(`[cron/session-warning:${reqId}] sent phone=${maskPhone(conv.phone)} flow=${conv.flow} step=${conv.step}`)
    } catch (err) {
      errors++
      console.error(`[cron/session-warning:${reqId}] error phone=${maskPhone(conv.phone)}:`, err)
    }
  }

  return NextResponse.json({ found: candidates.length, sent, skipped, errors })
}

function resolveFirstName(data: unknown): string {
  const d = data as Record<string, unknown> | null
  const name = (d?.name as string | undefined) ?? (d?.customerName as string | undefined)
  if (name && typeof name === 'string' && name.trim().length > 0) {
    return name.trim().split(' ')[0]
  }
  return 'there'
}
