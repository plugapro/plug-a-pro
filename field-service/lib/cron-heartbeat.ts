// ─── Cron heartbeats (audit OBS-09) ───────────────────────────────────────────
// Dead-man detection for Vercel crons. Every wrapped cron route records
// start/success/failure into the CronHeartbeat table via withCronHeartbeat().
// /api/cron/heartbeat-watchdog compares lastSucceededAt against ~2× each
// cron's scheduled interval and sends a throttled admin WhatsApp alert when a
// cron has gone quiet. Pure staleness math lives here so it is unit-testable.
//
// Invariant: the recorder must NEVER throw or change a cron's behaviour -
// heartbeat persistence failures are logged and swallowed.

import { db } from '@/lib/db'

/**
 * Expected MAXIMUM gap (minutes) between successful runs per cron, derived
 * from the vercel.json schedules (schedule hours are UTC; several crons have
 * long overnight windows, so this is the worst-case scheduled gap, not the
 * peak-hours interval). A cron counts as stale once
 * now - lastSucceededAt > 2 × this value.
 */
export const CRON_EXPECTED_MAX_GAP_MINUTES: Record<string, number> = {
  // vercel.json: */5 5-16 + */30 17-23,0-4 → worst gap 30 min
  'match-leads': 30,
  // 0 * * * * (hourly)
  'expire-payment-intents': 60,
  // */25 5-16 + 0,55 17-23,0-4 → worst gap 60 min
  'provider-auto-approve': 60,
  // 30 * * * * (hourly)
  'heartbeat-watchdog': 60,
  // */5 6-22 → overnight gap 22:55→06:00 ≈ 7 h
  'rebuild-candidate-pool': 480,
  // */20 5-20 → overnight gap 20:40→05:00 ≈ 8.3 h
  'session-timeout': 510,
  'provider-onboarding-recovery': 510,
  // */5 5-20 → overnight gap ≈ 8.1 h
  'session-warning': 510,
  // 0 6-20 hourly → overnight gap 20:00→06:00 = 10 h
  'identity-verification-in-flight-renudge': 600,
  // 15 6-20 hourly → overnight gap 10 h
  'customer-match-confirmation-nudge': 600,
  // 0 6-20/2 → overnight gap 10 h
  'ops-agents': 600,
  // 30 7,12,17 → longest gap 17:30→07:30 = 14 h
  'customer-abandoned-recovery': 840,
  // Daily crons
  reminders: 1440,
  'follow-up': 1440,
  'location-audit': 1440,
  'otp-security-prune': 1440,
  'completion-check': 1440,
  'kyc-drive-nudge': 1440,
  'daily-provider-snapshot': 1440,
  // 0 6 * * 1 (weekly)
  slots: 10080,
}

const STALE_MULTIPLIER = 2

/** Throttle: at most one watchdog WhatsApp alert per cron per 6 hours. */
export const ALERT_THROTTLE_MINUTES = 6 * 60

const MAX_ERROR_LENGTH = 500

export function staleThresholdMinutes(cronKey: string): number | null {
  const gap = CRON_EXPECTED_MAX_GAP_MINUTES[cronKey]
  return typeof gap === 'number' ? gap * STALE_MULTIPLIER : null
}

/**
 * A cron is stale when it has recorded at least one heartbeat (row exists)
 * but its last SUCCESS is missing or older than 2× its expected interval.
 * Crons without an interval mapping are never flagged (unknown schedule).
 */
export function isCronStale(
  cronKey: string,
  lastSucceededAt: Date | null,
  now: Date = new Date(),
): boolean {
  const threshold = staleThresholdMinutes(cronKey)
  if (threshold === null) return false
  if (!lastSucceededAt) return true
  const ageMinutes = (now.getTime() - lastSucceededAt.getTime()) / 60_000
  return ageMinutes > threshold
}

export interface CronHeartbeatSnapshot {
  cronKey: string
  lastStartedAt: Date | null
  lastSucceededAt: Date | null
  lastFailedAt: Date | null
  lastError: string | null
  consecutiveFailures: number
  lastAlertAt: Date | null
}

export interface StaleCron {
  cronKey: string
  /** Minutes since the last successful run; null when it has never succeeded. */
  minutesSinceSuccess: number | null
  thresholdMinutes: number
  consecutiveFailures: number
  lastError: string | null
  lastAlertAt: Date | null
}

/** Pure staleness selection over heartbeat rows - used by the watchdog and dashboard. */
export function selectStaleCrons(
  rows: CronHeartbeatSnapshot[],
  now: Date = new Date(),
): StaleCron[] {
  const stale: StaleCron[] = []
  for (const row of rows) {
    const threshold = staleThresholdMinutes(row.cronKey)
    if (threshold === null) continue
    if (!isCronStale(row.cronKey, row.lastSucceededAt, now)) continue
    stale.push({
      cronKey: row.cronKey,
      minutesSinceSuccess: row.lastSucceededAt
        ? Math.round((now.getTime() - row.lastSucceededAt.getTime()) / 60_000)
        : null,
      thresholdMinutes: threshold,
      consecutiveFailures: row.consecutiveFailures,
      lastError: row.lastError,
      lastAlertAt: row.lastAlertAt,
    })
  }
  return stale.sort((a, b) => a.cronKey.localeCompare(b.cronKey))
}

/** True when this stale cron may be alerted again (≥6 h since the last alert). */
export function shouldAlertForStaleCron(
  lastAlertAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastAlertAt) return true
  return now.getTime() - lastAlertAt.getTime() >= ALERT_THROTTLE_MINUTES * 60_000
}

function truncateError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text
}

async function recordStart(cronKey: string, now: Date): Promise<void> {
  try {
    await db.cronHeartbeat.upsert({
      where: { cronKey },
      create: { cronKey, lastStartedAt: now },
      update: { lastStartedAt: now },
    })
  } catch (error) {
    console.error(`[cron-heartbeat] failed to record start for ${cronKey}:`, error)
  }
}

async function recordSuccess(cronKey: string, now: Date): Promise<void> {
  try {
    await db.cronHeartbeat.upsert({
      where: { cronKey },
      create: { cronKey, lastSucceededAt: now, consecutiveFailures: 0 },
      update: { lastSucceededAt: now, consecutiveFailures: 0, lastError: null },
    })
  } catch (error) {
    console.error(`[cron-heartbeat] failed to record success for ${cronKey}:`, error)
  }
}

async function recordFailure(cronKey: string, now: Date, error: unknown): Promise<void> {
  try {
    const lastError = truncateError(error)
    await db.cronHeartbeat.upsert({
      where: { cronKey },
      create: { cronKey, lastFailedAt: now, lastError, consecutiveFailures: 1 },
      update: { lastFailedAt: now, lastError, consecutiveFailures: { increment: 1 } },
    })
  } catch (recordError) {
    console.error(`[cron-heartbeat] failed to record failure for ${cronKey}:`, recordError)
  }
}

/**
 * Wrap a cron handler with heartbeat recording.
 *
 * - Records lastStartedAt before the handler runs.
 * - Records lastSucceededAt when the handler resolves (a resolved Response
 *   with status >= 500 counts as a failure - some crons return error
 *   responses instead of throwing).
 * - Records lastFailedAt + lastError and rethrows when the handler throws.
 * - Heartbeat persistence failures are logged and never affect the handler.
 */
export async function withCronHeartbeat<T>(
  cronKey: string,
  handler: () => Promise<T>,
): Promise<T> {
  await recordStart(cronKey, new Date())
  try {
    const result = await handler()
    if (result instanceof Response && result.status >= 500) {
      await recordFailure(cronKey, new Date(), new Error(`HTTP ${result.status}`))
    } else {
      await recordSuccess(cronKey, new Date())
    }
    return result
  } catch (error) {
    await recordFailure(cronKey, new Date(), error)
    throw error
  }
}

/**
 * Dashboard summary: every known heartbeat row plus the stale subset.
 * Read-only; swallows nothing - callers decide how to handle load errors.
 */
export async function getCronHeartbeatSummary(now: Date = new Date()): Promise<{
  total: number
  stale: StaleCron[]
}> {
  const rows = await db.cronHeartbeat.findMany({
    where: { cronKey: { in: Object.keys(CRON_EXPECTED_MAX_GAP_MINUTES) } },
  })
  return { total: rows.length, stale: selectStaleCrons(rows, now) }
}
