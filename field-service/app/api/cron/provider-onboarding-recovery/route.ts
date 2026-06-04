// ─── Cron: Provider WhatsApp onboarding recovery queue ──────────────────────
// Reports stalled provider onboarding rows for operator follow-up. This route
// intentionally does not send WhatsApp messages; recovery sends must be run by
// an operator through the audited ops script after reviewing the queue.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  listProviderOnboardingRecoveryRows,
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
    const rows = await listProviderOnboardingRecoveryRows(db, { now })
    const summary = summarizeProviderOnboardingRecoveryRows(rows)
    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      mode: 'manual_queue_only',
      durationMs,
      ...summary,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({
      ok: true,
      mode: 'manual_queue_only',
      durationMs,
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
