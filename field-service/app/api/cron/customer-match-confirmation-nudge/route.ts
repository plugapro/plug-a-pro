// ─── Cron: Nudge customers whose matched provider hasn't been confirmed ───────
// Finds matches in status=MATCHED that have not been customer-confirmed within N
// hours of acceptance AND whose customer is outside the 24h WhatsApp window
// (so the original post-match notice has likely failed Re-engagement). Sends the
// `please_confirm_with_provider` UTILITY template, which delivers outside the
// window. Dedup is enforced by message_events lookup so a customer never gets
// more than one nudge per match.
//
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).
// Flag-gated by `customer.match_confirmation_nudge.cron` — when disabled, the
// route returns immediately with skipped=0.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { hasSuccessfulMessageForRecipient } from '@/lib/message-events'
import { sendPleaseConfirmWithProvider } from '@/lib/whatsapp'
import { hasRecentInboundWhatsappSession } from '@/lib/whatsapp-policy'

const FLAG = 'customer.match_confirmation_nudge.cron'

// Window for when to nudge: match was matched between 6h and 72h ago.
// Lower bound gives the original auto-notify a chance to land and the customer
// a window to engage on their own; upper bound stops us pestering long-dead
// matches.
const MIN_AGE_HOURS = 6
const MAX_AGE_HOURS = 72

function firstName(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/)[0] || 'there'
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'customer-match-confirmation-nudge'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  const enabled = await isEnabled(FLAG)
  if (!enabled) {
    console.log(JSON.stringify({ event: 'cron_skipped', cron: cronName, reason: 'flag_disabled', flag: FLAG }))
    return NextResponse.json({ skipped: 0, reason: 'flag_disabled' })
  }

  try {
    const reqId = crypto.randomUUID().slice(0, 8)
    const now = new Date()
    const upper = new Date(now.getTime() - MIN_AGE_HOURS * 60 * 60 * 1000)
    const lower = new Date(now.getTime() - MAX_AGE_HOURS * 60 * 60 * 1000)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.plugapro.co.za'

    const matches = await db.match.findMany({
      where: {
        status: 'MATCHED',
        customerContactedAt: null,
        createdAt: { gte: lower, lte: upper },
      },
      include: {
        provider: { select: { id: true, name: true, phone: true } },
        jobRequest: {
          include: {
            customer: { select: { id: true, name: true, phone: true, isTestUser: true } },
          },
        },
      },
      take: 100,
    })

    let sent = 0
    let skippedWindowOpen = 0
    let skippedAlreadyNudged = 0
    let failed = 0

    for (const match of matches) {
      const customer = match.jobRequest.customer
      if (!customer.phone) continue

      try {
        // 1. If customer's 24h window is OPEN, the freeform path inside
        //    notifyPostMatchAcceptance already had the chance to land —
        //    skip to avoid double-touch noise.
        const windowOpen = await hasRecentInboundWhatsappSession(customer.phone).catch(() => false)
        if (windowOpen) {
          skippedWindowOpen++
          console.info(`[cron/${cronName}:${reqId}] window_open, skipping match ${match.id}`)
          continue
        }

        // 2. Dedup: never send more than one nudge per match.
        const alreadyNudged = await hasSuccessfulMessageForRecipient({
          to: customer.phone,
          templateName: 'please_confirm_with_provider',
          metadataPath: ['matchId'],
          metadataEquals: match.id,
        })
        if (alreadyNudged) {
          skippedAlreadyNudged++
          console.info(`[cron/${cronName}:${reqId}] already_nudged, skipping match ${match.id}`)
          continue
        }

        const requestUrl = `${appUrl}/requests/${match.jobRequestId}`
        await sendPleaseConfirmWithProvider({
          customerPhone: customer.phone,
          customerName: firstName(customer.name),
          providerName: match.provider.name,
          serviceName: match.jobRequest.category,
          requestUrl,
          jobRequestId: match.jobRequestId,
          matchId: match.id,
        })
        sent++
        console.log(`[cron/${cronName}:${reqId}] nudged customer for match ${match.id}`)
      } catch (err) {
        failed++
        console.error(`[cron/${cronName}:${reqId}] failed match ${match.id}:`, err instanceof Error ? err.message : String(err))
      }
    }

    const duration = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      durationMs: duration,
      sent,
      skippedWindowOpen,
      skippedAlreadyNudged,
      failed,
      considered: matches.length,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({ sent, skippedWindowOpen, skippedAlreadyNudged, failed, considered: matches.length, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({
      event: 'cron_error',
      cron: cronName,
      durationMs: duration,
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }))
    throw err
  }
}
