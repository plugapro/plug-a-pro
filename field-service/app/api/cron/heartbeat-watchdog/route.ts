// ─── Cron: Heartbeat watchdog (audit OBS-09) ──────────────────────────────────
// Schedule: 30 * * * * (hourly, offset from the other hourly crons)
//
// Dead-man's switch for the wrapped crons: every cron route that goes through
// withCronHeartbeat() records start/success/failure into CronHeartbeat. This
// watchdog flags any cron whose lastSucceededAt is older than ~2x its
// vercel.json schedule interval (see CRON_EXPECTED_MAX_GAP_MINUTES) and sends
// the best-effort admin WhatsApp alert, throttled to one alert per cron per
// 6 hours via lastAlertAt.
//
// Limitations (by design, keep it simple):
// - A cron that has NEVER run has no heartbeat row and cannot be flagged.
// - The watchdog itself is a cron; it wraps itself so its own death is at
//   least visible in the CronHeartbeat table / admin dashboard.
// Secured by CRON_SECRET header (Authorization: Bearer <secret>).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  CRON_EXPECTED_MAX_GAP_MINUTES,
  selectStaleCrons,
  shouldAlertForStaleCron,
  withCronHeartbeat,
} from '@/lib/cron-heartbeat'
import { sendAdminCronStaleAlert } from '@/lib/whatsapp'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  return withCronHeartbeat('heartbeat-watchdog', () => runCron())
}

async function runCron() {
  const now = new Date()
  const rows = await db.cronHeartbeat.findMany({
    where: { cronKey: { in: Object.keys(CRON_EXPECTED_MAX_GAP_MINUTES) } },
  })

  const stale = selectStaleCrons(rows, now)
  let alerted = 0
  let throttled = 0

  for (const cron of stale) {
    if (!shouldAlertForStaleCron(cron.lastAlertAt, now)) {
      throttled++
      continue
    }

    const sent = await sendAdminCronStaleAlert({
      cronKey: cron.cronKey,
      minutesSinceSuccess: cron.minutesSinceSuccess,
      thresholdMinutes: cron.thresholdMinutes,
      consecutiveFailures: cron.consecutiveFailures,
      lastError: cron.lastError,
    }).catch((error: unknown) => {
      console.error('[cron/heartbeat-watchdog] stale-cron alert send failed', {
        cronKey: cron.cronKey,
        error,
      })
      return false
    })

    if (sent) {
      alerted++
      // Only a delivered alert arms the 6h throttle - a failed send should be
      // retried on the next hourly pass.
      await db.cronHeartbeat.update({
        where: { cronKey: cron.cronKey },
        data: { lastAlertAt: now },
      }).catch((error: unknown) => {
        console.error('[cron/heartbeat-watchdog] failed to record lastAlertAt', {
          cronKey: cron.cronKey,
          error,
        })
      })
    }
  }

  console.log('[cron/heartbeat-watchdog]', {
    tracked: rows.length,
    stale: stale.map((c) => c.cronKey),
    alerted,
    throttled,
  })

  return NextResponse.json({
    ok: true,
    tracked: rows.length,
    stale: stale.map((c) => ({
      cronKey: c.cronKey,
      minutesSinceSuccess: c.minutesSinceSuccess,
      thresholdMinutes: c.thresholdMinutes,
    })),
    alerted,
    throttled,
  })
}
