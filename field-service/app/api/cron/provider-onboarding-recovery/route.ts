// ─── Cron: Provider WhatsApp onboarding recovery queue ──────────────────────
// Sends audited, stage-specific recovery nudges for stalled provider onboarding
// rows. Add ?dryRun=1 to inspect the current queue without sending messages.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  listProviderOnboardingRecoveryRows,
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
    const url = new URL(request.url)
    const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true'
    const result = dryRun
      ? null
      : await sendProviderOnboardingRecoveryFollowUps(db, { now })
    const rows = result?.rows ?? await listProviderOnboardingRecoveryRows(db, { now })
    const summary = summarizeProviderOnboardingRecoveryRows(rows)
    const durationMs = Date.now() - cronStart
    console.log(JSON.stringify({
      event: 'cron_complete',
      cron: cronName,
      mode: dryRun ? 'dry_run' : 'automated_nudges',
      durationMs,
      sent: result?.sent ?? 0,
      skipped: result?.skipped ?? 0,
      errors: result?.errors ?? 0,
      ...summary,
      timestamp: new Date().toISOString(),
    }))
    return NextResponse.json({
      ok: true,
      mode: dryRun ? 'dry_run' : 'automated_nudges',
      durationMs,
      sent: result?.sent ?? 0,
      skipped: result?.skipped ?? 0,
      errors: result?.errors ?? 0,
      sentRefs: result?.sentRefs ?? [],
      skippedRefs: result?.skippedRefs ?? [],
      errorRefs: result?.errorRefs ?? [],
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
