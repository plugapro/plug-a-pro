import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { recordAuditLog } from './audit'

export type RateLimitContext = Record<string, unknown>

type LimiterKey = 'sendByPhone' | 'sendByIp' | 'verifyByPhone'

type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterMs: number; reason: 'limited' | 'limiter_unavailable' }

type LimitConfig = { name: LimiterKey; limit: number; windowSec: number }

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
  // injects (KV_REST_API_*), and the names the Vercel Upstash-for-Redis
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
    prefix: `otp:${cfg.name}`,
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
    // swallow — we never want audit to break the auth path
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

export type CheckOtpVerifyLimitResult =
  | { ok: true }
  | { ok: false; code: 'verify_limit' | 'limiter_unavailable'; retryAfterMs: number }

export async function checkOtpVerifyLimit(params: {
  phone: string
  context?: RateLimitContext
}): Promise<CheckOtpVerifyLimitResult> {
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

/** Test helper. Clears the lazy clients, one-shot warning state, and in-memory store. */
export function resetRateLimitForTests(): void {
  _redis = null
  _limiters = {}
  _degradedNotice = false
  _memoryStore.clear()
}
