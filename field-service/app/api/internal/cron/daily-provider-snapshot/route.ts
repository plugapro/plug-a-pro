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
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import {
  collectDailyProviderSnapshot,
  persistDailyProviderSnapshot,
  sendDailySnapshotDigest,
} from '@/lib/operational-snapshots/daily-provider-snapshot'

const CRON_NAME = 'daily-provider-snapshot'

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

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

    // Soft post-step: WhatsApp digest to ADMIN_WHATSAPP_NUMBER. Gated off by
    // default; flip `ops.daily_snapshot_whatsapp_digest` once the Meta template
    // `admin_daily_provider_snapshot` is approved. Send failure is logged but
    // does NOT roll back the snapshot row or 500 the cron — the snapshot data
    // path is independent of the notification path.
    let digest: { sent: boolean; reason?: string; error?: string } = {
      sent: false,
      reason: 'flag_disabled',
    }
    if (await isEnabled('ops.daily_snapshot_whatsapp_digest')) {
      const result = await sendDailySnapshotDigest(metrics)
      digest = result
      if (!result.sent) {
        console.warn(
          JSON.stringify({
            event: 'cron_digest_skipped',
            cron: CRON_NAME,
            snapshotId: row.id,
            reason: result.reason,
            error: result.error,
            timestamp: new Date().toISOString(),
          }),
        )
      } else {
        console.log(
          JSON.stringify({
            event: 'cron_digest_sent',
            cron: CRON_NAME,
            snapshotId: row.id,
            messageId: result.messageId,
            timestamp: new Date().toISOString(),
          }),
        )
      }
    }

    const durationMs = Date.now() - cronStart
    console.log(
      JSON.stringify({
        event: 'cron_complete',
        cron: CRON_NAME,
        durationMs,
        snapshotDate: row.snapshotDate.toISOString(),
        snapshotId: row.id,
        digestSent: digest.sent,
        timestamp: new Date().toISOString(),
      }),
    )

    return NextResponse.json({
      ok: true,
      cron: CRON_NAME,
      snapshotDate: row.snapshotDate.toISOString().slice(0, 10),
      snapshotId: row.id,
      durationMs,
      digest,
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
