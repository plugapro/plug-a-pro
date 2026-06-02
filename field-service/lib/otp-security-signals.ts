import { db } from './db'

export type SecurityCheckTrigger =
  | 'always_on'
  | 'send_velocity'
  | 'ip_diversity'
  | 'prior_event'

export type ShouldSendSecurityCheckResult = {
  trigger: SecurityCheckTrigger | null
  /** Populated only when trigger is non-null - for log/audit shaping. */
  signalDetail?: {
    sendCountLastHour?: number
    distinctIpsLast30Min?: number
    priorEventId?: string
  }
}

const SEND_VELOCITY_WINDOW_MS = 60 * 60_000
const SEND_VELOCITY_THRESHOLD = 3
const IP_DIVERSITY_WINDOW_MS = 30 * 60_000
const IP_DIVERSITY_THRESHOLD = 2
// Shortened from 90d → 14d. The 90d window meant a single false-positive
// security_event spammed the security-check prompt for ~270 sign-ins
// (90d × 3 sign-ins/day) before naturally aging out. 14d still catches a
// repeat-attempt-after-the-first-strike pattern; admins typically resolve
// or acknowledge events within a fortnight, after which the signal stops.
const PRIOR_EVENT_WINDOW_MS = 14 * 24 * 60 * 60_000
const SIGNAL_LOOKUP_TIMEOUT_MS = 1500

type SignalsClient = {
  otpChallenge: {
    count(args: { where: Record<string, unknown> }): Promise<number>
    findMany(args: {
      where: Record<string, unknown>
      select: { requestedIpHash: true }
      take?: number
    }): Promise<Array<{ requestedIpHash: string | null }>>
  }
  securityEvent: {
    findFirst(args: {
      where: Record<string, unknown>
      select: { id: true }
      orderBy?: { createdAt: 'desc' }
    }): Promise<{ id: string } | null>
  }
}

function signalsDb(): SignalsClient {
  return db as unknown as SignalsClient
}

async function withTimeout<T>(
  promise: Promise<T>,
  signalName: SecurityCheckTrigger,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`otp_security_signals_timeout:${signalName}`)),
          SIGNAL_LOOKUP_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Returns whether to fire an `otp_security_check` template after this OTP
 * send. Short-circuits on the cheapest signal first.
 *
 * Failure mode: any unexpected throw or timeout returns `{ trigger: null }`
 * (skip silently). The caller MUST treat this as best-effort - the OTP
 * delivery itself never blocks on this check.
 */
export async function shouldSendSecurityCheck(params: {
  phoneE164: string
  now?: Date
}): Promise<ShouldSendSecurityCheckResult> {
  const now = params.now ?? new Date()
  const client = signalsDb()

  // Signal 1: send-velocity (cheapest - single COUNT on an indexed column).
  try {
    const sendCountLastHour = await withTimeout(
      client.otpChallenge.count({
        where: {
          phoneE164: params.phoneE164,
          createdAt: { gte: new Date(now.getTime() - SEND_VELOCITY_WINDOW_MS) },
        },
      }),
      'send_velocity',
    )
    if (sendCountLastHour >= SEND_VELOCITY_THRESHOLD) {
      return {
        trigger: 'send_velocity',
        signalDetail: { sendCountLastHour },
      }
    }
  } catch {
    // fall through; do NOT propagate
    return { trigger: null }
  }

  // Signal 2: ip-diversity. We pull up to 50 recent rows and count distinct
  // non-null requestedIpHash values. Capped at 50 because anything past that
  // already crosses the threshold and the cost of the extra rows isn't worth
  // it - the index covers (phoneE164, createdAt) so the read is cheap anyway.
  try {
    const recentRows = await withTimeout(
      client.otpChallenge.findMany({
        where: {
          phoneE164: params.phoneE164,
          createdAt: { gte: new Date(now.getTime() - IP_DIVERSITY_WINDOW_MS) },
        },
        select: { requestedIpHash: true },
        take: 50,
      }),
      'ip_diversity',
    )
    const distinctIps = new Set<string>()
    for (const row of recentRows) {
      if (row.requestedIpHash) distinctIps.add(row.requestedIpHash)
    }
    if (distinctIps.size >= IP_DIVERSITY_THRESHOLD) {
      return {
        trigger: 'ip_diversity',
        signalDetail: { distinctIpsLast30Min: distinctIps.size },
      }
    }
  } catch {
    return { trigger: null }
  }

  // Signal 3: prior unresolved event in the last 14 days.
  try {
    const priorEvent = await withTimeout(
      client.securityEvent.findFirst({
        where: {
          phoneE164: params.phoneE164,
          status: { in: ['NEW', 'ACKNOWLEDGED'] },
          createdAt: { gte: new Date(now.getTime() - PRIOR_EVENT_WINDOW_MS) },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      }),
      'prior_event',
    )
    if (priorEvent) {
      return {
        trigger: 'prior_event',
        signalDetail: { priorEventId: priorEvent.id },
      }
    }
  } catch {
    return { trigger: null }
  }

  return { trigger: null }
}
