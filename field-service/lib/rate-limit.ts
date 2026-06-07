import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { recordAuditLog } from './audit'
import { isInternalTestPhone } from './internal-test-cohort'

export type RateLimitContext = Record<string, unknown>

type LimiterKey =
  | 'sendByPhone'
  | 'sendByIp'
  | 'verifyByPhone'
  | 'otpReportByIp'
  | 'providerSendCodePublicByIpPhone'
  | 'providerLookupByPhone'
  | 'providerLookupByIp'
  | 'payatGoCreateByBookingUser'
  | 'payatGoStatusByBookingUser'
  | 'payatGoCancelByBookingUser'
  | 'payatGoCallbackByReference'
  | 'voucherMalformedByProvider'
  | 'voucherFailedByProvider'

type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterMs: number; reason: 'limited' | 'limiter_unavailable' }

type LimitConfig = { name: LimiterKey; limit: number; windowSec: number; prefix?: string }

const TEN_MINUTES = 10 * 60
const HOUR = 60 * 60

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function configs(): Record<LimiterKey, LimitConfig> {
  return {
    sendByPhone: {
      name: 'sendByPhone',
      limit: envInt('OTP_SEND_LIMIT_PER_PHONE_HOUR', 5),
      windowSec: HOUR,
    },
    sendByIp: {
      name: 'sendByIp',
      limit: envInt('OTP_SEND_LIMIT_PER_IP_HOUR', 20),
      windowSec: HOUR,
    },
    verifyByPhone: {
      name: 'verifyByPhone',
      limit: envInt('OTP_VERIFY_LIMIT_PER_PHONE_HOUR', 10),
      windowSec: HOUR,
    },
    otpReportByIp: {
      name: 'otpReportByIp',
      limit: envInt('OTP_REPORT_LIMIT_PER_IP_HOUR', 60),
      windowSec: HOUR,
    },
    providerSendCodePublicByIpPhone: {
      name: 'providerSendCodePublicByIpPhone',
      limit: envInt('PROVIDER_SEND_CODE_PUBLIC_LIMIT_PER_IP_PHONE_HOUR', 6),
      windowSec: HOUR,
    },
    providerLookupByPhone: {
      name: 'providerLookupByPhone',
      limit: envInt('PROVIDER_LOOKUP_LIMIT_PER_PHONE_HOUR', 12),
      windowSec: HOUR,
    },
    providerLookupByIp: {
      name: 'providerLookupByIp',
      limit: envInt('PROVIDER_LOOKUP_LIMIT_PER_IP_HOUR', 60),
      windowSec: HOUR,
    },
    payatGoCreateByBookingUser: {
      name: 'payatGoCreateByBookingUser',
      limit: envInt('PAYAT_GO_CREATE_LIMIT_PER_BOOKING_USER_HOUR', 12),
      windowSec: HOUR,
    },
    payatGoStatusByBookingUser: {
      name: 'payatGoStatusByBookingUser',
      limit: envInt('PAYAT_GO_STATUS_LIMIT_PER_BOOKING_USER_HOUR', 120),
      windowSec: HOUR,
    },
    payatGoCancelByBookingUser: {
      name: 'payatGoCancelByBookingUser',
      limit: envInt('PAYAT_GO_CANCEL_LIMIT_PER_BOOKING_USER_HOUR', 20),
      windowSec: HOUR,
    },
    payatGoCallbackByReference: {
      name: 'payatGoCallbackByReference',
      limit: envInt('PAYAT_GO_CALLBACK_LIMIT_PER_REFERENCE_HOUR', 120),
      windowSec: HOUR,
    },
    voucherMalformedByProvider: {
      name: 'voucherMalformedByProvider',
      limit: envInt('VOUCHER_REDEMPTION_MALFORMED_LIMIT_PER_PROVIDER_10_MINUTES', 5),
      windowSec: TEN_MINUTES,
      prefix: 'rate_limit',
    },
    voucherFailedByProvider: {
      name: 'voucherFailedByProvider',
      limit: envInt('VOUCHER_REDEMPTION_FAILED_LIMIT_PER_PROVIDER_HOUR', 20),
      windowSec: HOUR,
      prefix: 'rate_limit',
    },
  }
}

let _redis: Redis | null = null
let _limiters: Partial<Record<LimiterKey, Ratelimit>> = {}
let _degradedNotice = false

type MemoryWindowEntry = { count: number; windowStart: number }
const _memoryStore = new Map<string, MemoryWindowEntry>()

function memoryConsume(key: string, limit: number, windowMs: number): RateLimitDecision {
  const now = Date.now()
  const entry = _memoryStore.get(key)
  if (!entry || now - entry.windowStart > windowMs) {
    _memoryStore.set(key, { count: 1, windowStart: now })
    return { ok: true }
  }
  if (entry.count >= limit) {
    return { ok: false, retryAfterMs: windowMs - (now - entry.windowStart), reason: 'limited' }
  }
  entry.count++
  return { ok: true }
}

function allowMemoryFallback(): boolean {
  if (process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK === 'true') return true
  if (process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK === 'false') return false
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production'
}

function getRedis(): Redis | null {
  if (_redis) return _redis
  // Accept canonical Upstash names, the names Vercel's Marketplace integration
  // injects (KV_REST_API_*) and the names the Vercel Upstash-for-Redis
  // integration injects (UPSTASH_REDIS_KV_REST_API_*).
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_KV_REST_API_URL ??
    process.env.KV_REST_API_URL
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ??
    process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    if (!_degradedNotice) {
      _degradedNotice = true
      console.warn(
        '[rate-limit] Upstash Redis env vars missing; durable rate limiting unavailable',
      )
      void emitDegradedAudit('upstash_env_missing').catch(() => undefined)
    }
    return null
  }
  _redis = new Redis({ url, token })
  return _redis
}

function getLimiter(key: LimiterKey): Ratelimit | null {
  if (_limiters[key]) return _limiters[key]!
  const redis = getRedis()
  if (!redis) return null
  const cfg = configs()[key]
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.limit, `${cfg.windowSec} s`),
    analytics: false,
    prefix: `${cfg.prefix ?? 'otp'}:${cfg.name}`,
  })
  _limiters[key] = limiter
  return limiter
}

async function emitDegradedAudit(reason: string): Promise<void> {
  try {
    await recordAuditLog({
      actorId: 'system',
      actorRole: 'rate_limit',
      action: 'rate_limit.degraded',
      entityType: 'rate_limit',
      entityId: reason,
    })
  } catch {
    // swallow - we never want audit to break the auth path
  }
}

async function consume(
  key: LimiterKey,
  identifier: string,
): Promise<RateLimitDecision> {
  const limiter = getLimiter(key)
  if (!limiter) {
    if (!allowMemoryFallback()) {
      return { ok: false, retryAfterMs: 60_000, reason: 'limiter_unavailable' }
    }
    const cfg = configs()[key]
    return memoryConsume(`${key}:${identifier}`, cfg.limit, cfg.windowSec * 1000)
  }
  try {
    const result = await limiter.limit(identifier)
    if (result.success) return { ok: true }
    const retryAfterMs = Math.max(0, result.reset - Date.now())
    return { ok: false, retryAfterMs, reason: 'limited' }
  } catch (err) {
    console.warn('[rate-limit] limiter error; failing closed', {
      key,
      error: err instanceof Error ? err.message : String(err),
    })
    void emitDegradedAudit(`limiter_error:${key}`).catch(() => undefined)
    return { ok: false, retryAfterMs: 60_000, reason: 'limiter_unavailable' }
  }
}

export type CheckOtpSendLimitResult =
  | { ok: true }
  | { ok: false; code: 'phone_limit' | 'ip_limit' | 'limiter_unavailable'; retryAfterMs: number }

export async function checkOtpSendLimit(params: {
  phone: string
  ip?: string | null
  context?: RateLimitContext
}): Promise<CheckOtpSendLimitResult> {
  if (isInternalTestPhone(params.phone)) return { ok: true }
  const phoneDecision = await consume('sendByPhone', `phone:${params.phone}`)
  if (!phoneDecision.ok) {
    return {
      ok: false,
      code: phoneDecision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'phone_limit',
      retryAfterMs: phoneDecision.retryAfterMs,
    }
  }

  const ip = params.ip?.trim()
  if (ip) {
    const ipDecision = await consume('sendByIp', `ip:${ip}`)
    if (!ipDecision.ok) {
      return {
        ok: false,
        code: ipDecision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'ip_limit',
        retryAfterMs: ipDecision.retryAfterMs,
      }
    }
  }

  return { ok: true }
}

export type CheckProviderLookupLimitResult =
  | { ok: true }
  | { ok: false; code: 'phone_limit' | 'ip_limit' | 'limiter_unavailable'; retryAfterMs: number }

export type CheckPublicProviderSendCodeLimitResult =
  | { ok: true }
  | { ok: false; code: 'ip_phone_limit' | 'limiter_unavailable'; retryAfterMs: number }

export async function checkPublicProviderSendCodeLimit(params: {
  phone: string
  ip?: string | null
  context?: RateLimitContext
}): Promise<CheckPublicProviderSendCodeLimitResult> {
  if (isInternalTestPhone(params.phone)) return { ok: true }
  // Keep the public pre-lookup limiter keyed to IP+phone so anonymous traffic
  // cannot brute-force lookup attempts for the same number from one source.
  const ip = params.ip?.trim() || 'unknown'
  const decision = await consume(
    'providerSendCodePublicByIpPhone',
    `ip_phone:${ip}:${params.phone}`,
  )
  if (!decision.ok) {
    return {
      ok: false,
      code: decision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'ip_phone_limit',
      retryAfterMs: decision.retryAfterMs,
    }
  }

  return { ok: true }
}

export async function checkProviderLookupLimit(params: {
  phone: string
  ip?: string | null
  context?: RateLimitContext
}): Promise<CheckProviderLookupLimitResult> {
  if (isInternalTestPhone(params.phone)) return { ok: true }
  const phoneDecision = await consume('providerLookupByPhone', `phone:${params.phone}`)
  if (!phoneDecision.ok) {
    return {
      ok: false,
      code: phoneDecision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'phone_limit',
      retryAfterMs: phoneDecision.retryAfterMs,
    }
  }

  const ip = params.ip?.trim()
  if (ip) {
    const ipDecision = await consume('providerLookupByIp', `ip:${ip}`)
    if (!ipDecision.ok) {
      return {
        ok: false,
        code: ipDecision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'ip_limit',
        retryAfterMs: ipDecision.retryAfterMs,
      }
    }
  }

  return { ok: true }
}

export type CheckOtpVerifyLimitResult =
  | { ok: true }
  | { ok: false; code: 'verify_limit' | 'limiter_unavailable'; retryAfterMs: number }

export async function checkOtpVerifyLimit(params: {
  phone: string
  context?: RateLimitContext
}): Promise<CheckOtpVerifyLimitResult> {
  if (isInternalTestPhone(params.phone)) return { ok: true }
  const decision = await consume('verifyByPhone', `phone:${params.phone}`)
  if (!decision.ok) {
    return {
      ok: false,
      code: decision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'verify_limit',
      retryAfterMs: decision.retryAfterMs,
    }
  }
  return { ok: true }
}

export type CheckOtpReportLimitResult =
  | { ok: true }
  | { ok: false; code: 'ip_limit' | 'limiter_unavailable'; retryAfterMs: number }

export async function checkOtpReportLimit(params: {
  ip?: string | null
  ua?: string | null
  context?: RateLimitContext
}): Promise<CheckOtpReportLimitResult> {
  const identifier = params.ip?.trim() || 'unknown'
  const decision = await consume('otpReportByIp', `ip:${identifier}`)
  if (!decision.ok) {
    return {
      ok: false,
      code: decision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'ip_limit',
      retryAfterMs: decision.retryAfterMs,
    }
  }
  return { ok: true }
}

export type CheckPayAtGoLimitResult =
  | { ok: true }
  | { ok: false; code: 'rate_limited' | 'limiter_unavailable'; retryAfterMs: number }

type PayAtGoOperation = 'create' | 'status' | 'cancel' | 'callback'

const PAYAT_GO_LIMIT_KEY_BY_OPERATION: Record<PayAtGoOperation, LimiterKey> = {
  create: 'payatGoCreateByBookingUser',
  status: 'payatGoStatusByBookingUser',
  cancel: 'payatGoCancelByBookingUser',
  callback: 'payatGoCallbackByReference',
}

export async function checkPayAtGoLimit(params: {
  operation: PayAtGoOperation
  identifier: string
}): Promise<CheckPayAtGoLimitResult> {
  const limiterKey = PAYAT_GO_LIMIT_KEY_BY_OPERATION[params.operation]
  const decision = await consume(limiterKey, params.identifier)
  if (!decision.ok) {
    return {
      ok: false,
      code: decision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'rate_limited',
      retryAfterMs: decision.retryAfterMs,
    }
  }

  return { ok: true }
}

export type CheckVoucherRedemptionLimitResult =
  | { ok: true }
  | { ok: false; code: 'rate_limited' | 'limiter_unavailable'; retryAfterMs: number }

type VoucherRedemptionLimitReason = 'malformed' | 'failed'

const VOUCHER_REDEMPTION_LIMIT_KEY_BY_REASON: Record<
  VoucherRedemptionLimitReason,
  LimiterKey
> = {
  malformed: 'voucherMalformedByProvider',
  failed: 'voucherFailedByProvider',
}

export async function checkVoucherRedemptionLimit(params: {
  providerId: string
  reason: VoucherRedemptionLimitReason
}): Promise<CheckVoucherRedemptionLimitResult> {
  const limiterKey = VOUCHER_REDEMPTION_LIMIT_KEY_BY_REASON[params.reason]
  const decision = await consume(limiterKey, `provider:${params.providerId}`)
  if (!decision.ok) {
    return {
      ok: false,
      code: decision.reason === 'limiter_unavailable' ? 'limiter_unavailable' : 'rate_limited',
      retryAfterMs: decision.retryAfterMs,
    }
  }

  return { ok: true }
}

/** Test helper. Clears the lazy clients, one-shot warning state and in-memory store. */
export function resetRateLimitForTests(): void {
  _redis = null
  _limiters = {}
  _degradedNotice = false
  _memoryStore.clear()
}
