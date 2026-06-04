// ─── Cron: Provider WhatsApp onboarding recovery nudges ─────────────────────
// Sends audit-limited WhatsApp follow-ups for stalled provider onboarding rows
// that are still inside the WhatsApp customer-care session window.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  sendProviderOnboardingRecoveryFollowUps,
  summarizeProviderOnboardingRecoveryRows,
} from '@/lib/provider-onboarding-recovery'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'provider-onboarding-recovery'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const now = new Date()
    const recovery = await sendProviderOnboardingRecoveryFollowUps(db, { now })
    const summary = summarizeProviderOnboardingRecoveryRows(recovery.rows)
    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      mode: 'auto_nudge',
      durationMs,
      sent: recovery.sent,
      skipped: recovery.skipped,
      errors: recovery.errors,
      ...summary,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({
      ok: true,
      mode: 'auto_nudge',
      durationMs,
      sent: recovery.sent,
      skipped: recovery.skipped,
      errors: recovery.errors,
      ...summary,
    })
  } catch (error) {
    const durationMs = Date.now() - cronStart
    console.error(JSON.stringify({
      event: 'cron_error',
      cron: cronName,
      durationMs,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }))
    throw error
  }
}
