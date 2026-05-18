// ─── Cron: WhatsApp session inactivity timeout ────────────────────────────────
// Schedule: */10 5-20 * * * (every 10 min, 07:00–22:00 SAST)
//
// For every mid-flow conversation that has expired and not yet been notified:
//   1. Atomically claim it via timeoutNotifiedAt (prevents duplicate sends)
//   2. Send the customer a polite "session ended" WhatsApp message
//   3. Leave flow/data intact — the bot's existing resume logic fires on next reply
//
// Only processes sessions where expiresAt is within the past 23 hours to ensure
// we remain inside the WhatsApp 24-hour session window (sendText is valid).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendText } from '@/lib/whatsapp-interactive'
import { maskPhone } from '@/lib/support-diagnostics'

// Flows that indicate an active mid-session state worth notifying about
const NOTIFIABLE_FLOWS = ['job_request', 'registration', 'status', 'help', 'reschedule', 'cancel']

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'session-timeout'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
  const reqId = crypto.randomUUID().slice(0, 8)
  const now = new Date()
  const LOCK_SENTINEL = new Date(0)

  // Lower bound: 23 hours ago — sessions older than this are outside the WhatsApp
  // 24h session window; sendText would fail, so skip them
  const windowFloor = new Date(now.getTime() - 23 * 60 * 60 * 1000)

  const expired = await db.conversation.findMany({
    where: {
      flow:             { in: NOTIFIABLE_FLOWS },
      expiresAt:        { lt: now, gt: windowFloor },
      timeoutNotifiedAt: null,
    },
    select: {
      id:    true,
      phone: true,
      flow:  true,
      data:  true,
    },
  })

  console.log(`[cron/session-timeout:${reqId}] found=${expired.length} candidates`)

  let sent    = 0
  let skipped = 0
  let errors  = 0

  for (const conv of expired) {
    try {
      // ── Atomic claim — only one cron instance wins per conversation ────────
      const claimed = await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: null },
        data:  { timeoutNotifiedAt: LOCK_SENTINEL },
      })

      if (claimed.count === 0) {
        // Another process already claimed this conversation
        skipped++
        console.info(`[cron/session-timeout:${reqId}] already-claimed phone=${maskPhone(conv.phone)} id=${conv.id}`)
        continue
      }

      // ── Resolve customer first name ────────────────────────────────────────
      const firstName = await resolveFirstName(conv.phone, conv.data)

      // ── Check service opt-in ───────────────────────────────────────────────
      const customer = await db.customer.findUnique({
        where:  { phone: conv.phone },
        select: { whatsappServiceOptIn: true },
      })

      if (customer && !customer.whatsappServiceOptIn) {
        console.info(`[cron/session-timeout:${reqId}] service-opted-out phone=${maskPhone(conv.phone)} — skipping send`)
        await db.conversation.updateMany({
          where: { id: conv.id, timeoutNotifiedAt: LOCK_SENTINEL },
          data:  { timeoutNotifiedAt: now },
        }).catch(() => {})
        skipped++
        continue
      }

      // ── Send timeout message ───────────────────────────────────────────────
      const message =
        `Hi ${firstName}, your session has ended because there was no activity for a while. ` +
        `Please reply to this message when you're ready to continue, and we'll help you pick up from there.`

      await sendText(conv.phone, message)

      // ── Write real timestamp only after confirmed send ─────────────────────
      await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: LOCK_SENTINEL },
        data:  { timeoutNotifiedAt: now },
      }).catch(() => {})

      sent++
      console.log(
        `[cron/session-timeout:${reqId}] sent phone=${maskPhone(conv.phone)} flow=${conv.flow} id=${conv.id}`
      )
    } catch (err) {
      errors++
      console.error(
        `[cron/session-timeout:${reqId}] error phone=${maskPhone(conv.phone)} id=${conv.id}:`,
        err
      )
    }
  }

  console.log(`[cron/session-timeout:${reqId}]`, { found: expired.length, sent, skipped, errors })
  const duration = Date.now() - cronStart
  console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
  return NextResponse.json({ found: expired.length, sent, skipped, errors, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveFirstName(phone: string, data: unknown): Promise<string> {
  // 1. Accumulated session data (fastest — already in memory)
  const sessionData = data as Record<string, unknown> | null
  const sessionName =
    (sessionData?.customerName as string | undefined) ??
    (sessionData?.name as string | undefined)

  if (sessionName) return sessionName.split(' ')[0]

  // 2. Customer record
  const customer = await db.customer.findUnique({
    where:  { phone },
    select: { name: true },
  })

  if (customer?.name) return customer.name.split(' ')[0]

  // 3. Fallback
  return 'there'
}
