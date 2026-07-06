// Cron: Phase 1 provider application auto-approval
// Runs on a dedicated schedule (all times SAST = UTC+2):
//   */25 5-16 * * *   -- every 25 min during standard hours (07:00-18:59 SAST)
//   0,55 17-23,0-4 * * * -- every ~55 min during off-hours (19:00-06:59 SAST)
//
// Approves PENDING applications that have all required fields. Applications
// missing name / skills / service areas / experience are skipped until
// corrected. HIGH_RISK_CATEGORY (Electrical, Roofing, Pest Control, Air
// Conditioning) requires manual ops review and is not auto-approved. Plumbing
// is standard and must not block approval.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { autoApproveProviderApplications } from '@/lib/provider-auto-approve'
import { withCronHeartbeat } from '@/lib/cron-heartbeat'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Audit OBS-09: record heartbeats so a silently-dead cron is detectable.
  return withCronHeartbeat('provider-auto-approve', () => runCron())
}

async function runCron() {

  const cronStart = Date.now()
  const cronName = 'provider-auto-approve'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
    const reqId = Math.random().toString(36).slice(2, 10)

    // Gate: disabled flag routes all applications to manual admin review only.
    const autoApproveEnabled = await isEnabled('provider.onboarding.auto_approve')
    if (!autoApproveEnabled) {
      console.log(`[cron/provider-auto-approve:${reqId}] skipped - feature flag provider.onboarding.auto_approve is disabled; applications require manual admin review`)
      const duration = Date.now() - cronStart
      console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
      return NextResponse.json({ ok: true, skipped: true, reason: 'FEATURE_FLAG_DISABLED', durationMs: duration })
    }

    const result = await autoApproveProviderApplications(db, { runId: reqId })
    console.log(`[cron/provider-auto-approve:${reqId}]`, result)
    const duration = Date.now() - cronStart
    console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
    return NextResponse.json({ ok: true, ...result, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    console.error(`[cron/provider-auto-approve] Fatal error:`, err)
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 })
  }
}
