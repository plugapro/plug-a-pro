// Daily Provider Snapshot Cron
//
// Schedules a daily aggregate of provider funnel + cost-to-serve metrics
// and persists one row per calendar day to daily_provider_snapshots.
//
// vercel.json schedule: "0 16 * * *" (16:00 UTC = 18:00 SAST).
//
// Auth: CRON_SECRET bearer token, identical pattern to the other internal crons.
// Idempotent: upsert by snapshotDate so re-runs are safe.

import { NextResponse } from 'next/server'
import { withCronHeartbeat } from '@/lib/cron-heartbeat'
import { db } from '@/lib/db'
import {
  collectDailyProviderSnapshot,
  persistDailyProviderSnapshot,
} from '@/lib/operational-snapshots/daily-provider-snapshot'

const CRON_NAME = 'daily-provider-snapshot'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Audit OBS-09: record heartbeats so a silently-dead cron is detectable.
  return withCronHeartbeat('daily-provider-snapshot', () => runCron())
}

async function runCron() {

  const cronStart = Date.now()
  console.log(
    JSON.stringify({
      event: 'cron_start',
      cron: CRON_NAME,
      timestamp: new Date().toISOString(),
    }),
  )

  try {
    const metrics = await collectDailyProviderSnapshot(db)
    const row = await persistDailyProviderSnapshot(db, metrics)

    const durationMs = Date.now() - cronStart
    console.log(
      JSON.stringify({
        event: 'cron_complete',
        cron: CRON_NAME,
        durationMs,
        snapshotDate: row.snapshotDate.toISOString(),
        snapshotId: row.id,
        timestamp: new Date().toISOString(),
      }),
    )

    return NextResponse.json({
      ok: true,
      cron: CRON_NAME,
      snapshotDate: row.snapshotDate.toISOString().slice(0, 10),
      snapshotId: row.id,
      durationMs,
      metrics: {
        appsApproved: metrics.appsApproved,
        appsPending: metrics.appsPending,
        appsMoreInfo: metrics.appsMoreInfo,
        providersActive: metrics.providersActive,
        providersVerified: metrics.providersVerified,
        pendingBreachingSla: metrics.pendingBreachingSla,
        approvalSlaHitRate: metrics.approvalSlaHitRate,
        approvalP50Minutes: metrics.approvalP50Minutes,
        approvalP90Minutes: metrics.approvalP90Minutes,
        whatsappOutbound30d: metrics.whatsappOutbound30d,
        otpAttempts30d: metrics.otpAttempts30d,
        promoCreditsHeld: metrics.promoCreditsHeld,
        paidCreditsHeld: metrics.paidCreditsHeld,
        leadUnlocks30d: metrics.leadUnlocks30d,
        jobRequests30d: metrics.jobRequests30d,
        applicationsLast7d: metrics.applicationsLast7d,
        approvedLast7d: metrics.approvedLast7d,
      },
    })
  } catch (err) {
    const durationMs = Date.now() - cronStart
    console.error(
      JSON.stringify({
        event: 'cron_error',
        cron: CRON_NAME,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      }),
    )
    return NextResponse.json(
      { ok: false, cron: CRON_NAME, error: 'snapshot_failed' },
      { status: 500 },
    )
  }
}

export const POST = GET
