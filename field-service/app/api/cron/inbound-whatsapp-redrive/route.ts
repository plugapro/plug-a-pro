// ─── Cron: Re-drive failed inbound WhatsApp messages ──────────────────────────
// Schedule: */10 5-22 * * * (every 10 min during active hours)
//
// The WhatsApp webhook records failureReason and leaves processedAt NULL when
// inbound processing throws, but nothing re-runs it — and Meta's own redelivery
// hits the WAMID duplicate guard and is dropped. So a customer reply that trips
// a transient bug is silently lost. This cron reprocesses those rows.
//
// Gated by the whatsapp.inbound.redrive flag: OFF = report-only (counts
// candidates, sends nothing). Poison messages age out of the 3h window instead
// of retrying forever (see lib/whatsapp-inbound-redrive.ts).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { processInboundMessage } from '@/lib/whatsapp-bot'
import { redriveInboundWhatsApp } from '@/lib/whatsapp-inbound-redrive'
import type { InboundMessage } from '@/lib/whatsapp-interactive'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'inbound-whatsapp-redrive'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const flagEnabled = await isEnabled('whatsapp.inbound.redrive')
    const summary = await redriveInboundWhatsApp({
      db,
      processMessage: (message: InboundMessage) => processInboundMessage(message),
      now: new Date(),
      flagEnabled,
    })

    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs, ...summary }))
    return NextResponse.json({ ok: true, durationMs, ...summary })
  } catch (err) {
    const durationMs = Date.now() - cronStart
    console.error(JSON.stringify({
      event: 'cron_error',
      cron: cronName,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    }))
    return NextResponse.json({ ok: false, error: 'redrive_failed' }, { status: 500 })
  }
}
