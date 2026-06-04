// ─── Cron: WhatsApp pre-expiry registration warning ──────────────────────────
// Schedule: */5 5-20 * * * (every 5 min, 07:00-22:00 SAST)
//
// For every mid-flow registration session within a single 5-minute slice of
// its expiry, send a "continue" WhatsApp template message before the freeform
// window slams shut.
//
// Coordination with session-timeout:
// We intentionally do NOT touch Conversation.timeoutNotifiedAt — that field
// is owned by the post-expiry session-timeout cron. The warning window is
// narrow enough (5–10 min before expiry) that the every-5-min schedule
// catches each session in exactly one cron run, so we don't need an atomic
// claim across runs.
//
// Dedupe across cron runs is enforced by the narrow window (>=5 and <10 min
// before expiry). Within a single cron run the for-loop is sequential, so
// each session is processed at most once. A secondary in-data marker
// (data.prewarningSentAt) catches rare cron-retry races.

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { sendTemplate } from '@/lib/whatsapp'
import { isEnabled } from '@/lib/flags'
import { maskPhone } from '@/lib/support-diagnostics'

const WARN_WINDOW_LOWER_MS = 5 * 60 * 1000
const WARN_WINDOW_UPPER_MS = 10 * 60 * 1000

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
  const lower = new Date(now.getTime() + WARN_WINDOW_LOWER_MS)
  const upper = new Date(now.getTime() + WARN_WINDOW_UPPER_MS)

  // Sessions whose expiresAt falls inside the warning window [now+5m, now+10m).
  // The 5-min cron interval matched to the 5-min-wide window means each session
  // is naturally caught in exactly one cron run.
  const candidates = await db.conversation.findMany({
    where: {
      flow: { in: [...FLOWS_TO_WARN] },
      expiresAt: { gte: lower, lt: upper },
    },
    select: { id: true, phone: true, flow: true, step: true, data: true },
  })

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const conv of candidates) {
    try {
      // Secondary dedupe: if we somehow already warned this session within the
      // window (e.g. cron retry), skip. Stored in the data JSON to avoid a
      // schema change. Best-effort — a small race window may still send twice.
      const dataObj = (conv.data ?? {}) as Record<string, unknown>
      if (typeof dataObj.prewarningSentAt === 'string') {
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

      // Mark as warned in the data JSON. We do NOT touch timeoutNotifiedAt —
      // that belongs to the post-expiry cron.
      await db.conversation.update({
        where: { id: conv.id },
        data: {
          data: { ...dataObj, prewarningSentAt: now.toISOString() } as Prisma.InputJsonValue,
        },
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
