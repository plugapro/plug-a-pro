// ─── Cron: Inbound WhatsApp dead-letter re-drive (SRE-03) ─────────────────────
//
// Sweeps inbound_whatsapp_messages rows where processedAt IS NULL and
// failureReason IS NOT NULL (received within the last 60 minutes, < 3
// attempts) and reprocesses them through the same bot entry point the webhook
// uses. Flag-gated by `whatsapp.inbound.redrive` (default OFF) — when disabled
// the cron runs but no-ops with a log line.
//
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { runInboundWhatsappRedrive } from '@/lib/inbound-whatsapp-redrive'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'inbound-whatsapp-redrive'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const summary = await runInboundWhatsappRedrive()
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      durationMs: duration,
      ...summary,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({ ...summary, durationMs: duration })
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
