import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { isEnabled, FLAG_KEYS } from '@/lib/flags'
import { checkHealthProbeLimit } from '@/lib/rate-limit'

const COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null
const COMMIT_REF = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GIT_COMMIT_REF ?? null
const BUILT_AT = process.env.VERCEL_DEPLOYMENT_CREATED_AT ?? null

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? null
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null
const HAS_PAYMENT_CREDENTIALS =
  Boolean(process.env.PEACH_ACCESS_TOKEN && process.env.PEACH_ENTITY_ID) ||
  Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY)

type FlagStatus = 'enabled' | 'disabled' | 'unknown'
type OtpSecurityReportConfigStatus = 'disabled' | 'ready' | 'missing_otp_hash_pepper' | 'unknown'

type WhatsAppProbeResult = 'ok' | 'error' | 'unknown'

// Cache the outbound WhatsApp Graph probe so repeated /api/health requests (the
// public status dashboard auto-refreshes every 30s) share a single upstream
// call instead of spending Graph API quota per request (finding f4a7b4b2).
const WHATSAPP_PROBE_TTL_MS = 60_000
let _whatsappProbeCache: { value: WhatsAppProbeResult; expiresAt: number } | null = null

async function runWhatsAppProbe(): Promise<WhatsAppProbeResult> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return 'unknown'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}?fields=display_phone_number`,
      {
        // Token is carried in the Authorization header, never the URL query
        // string, so it cannot leak into request logs/traces.
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        signal: controller.signal,
      },
    )
    clearTimeout(timeout)
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

async function probeWhatsApp(): Promise<WhatsAppProbeResult> {
  const now = Date.now()
  if (_whatsappProbeCache && _whatsappProbeCache.expiresAt > now) {
    return _whatsappProbeCache.value
  }
  const value = await runWhatsAppProbe()
  _whatsappProbeCache = { value, expiresAt: now + WHATSAPP_PROBE_TTL_MS }
  return value
}

function clientIp(request: NextRequest | undefined): string | null {
  if (!request) return null
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    null
  )
}

function flagStatus(result: PromiseSettledResult<boolean>): FlagStatus {
  if (result.status !== 'fulfilled') return 'unknown'
  return result.value ? 'enabled' : 'disabled'
}

function otpSecurityReportConfigStatus(flag: FlagStatus): OtpSecurityReportConfigStatus {
  if (flag === 'unknown') return 'unknown'
  if (flag === 'disabled') return 'disabled'
  return process.env.OTP_HASH_PEPPER?.trim() ? 'ready' : 'missing_otp_hash_pepper'
}

export async function GET(request?: NextRequest) {
  const timestamp = new Date().toISOString()

  // Per-IP rate limit so an unauthenticated attacker cannot amplify health
  // probes (DB query + cached WhatsApp probe) from a single source. Fails open
  // when the durable limiter is unavailable; the probe cache still bounds the
  // outbound WhatsApp cost.
  const probeLimit = await checkHealthProbeLimit({ ip: clientIp(request) })
  if (!probeLimit.ok) {
    return NextResponse.json(
      { status: 'rate_limited', timestamp },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(probeLimit.retryAfterMs / 1000)) },
      },
    )
  }
  const build = {
    commitSha: COMMIT_SHA,
    commitShaShort: COMMIT_SHA ? COMMIT_SHA.slice(0, 7) : null,
    commitRef: COMMIT_REF,
    builtAt: BUILT_AT,
  }

  const [dbResult, whatsappResult, otpFlagResult, otpSecurityReportFlagResult] = await Promise.allSettled([
    db.$queryRaw`SELECT 1`,
    probeWhatsApp(),
    isEnabled(FLAG_KEYS.AUTH_OTP_WHATSAPP),
    isEnabled('security.otp.report'),
  ])

  const dbOk = dbResult.status === 'fulfilled'
  const whatsapp = whatsappResult.status === 'fulfilled' ? whatsappResult.value : 'error'
  const payments: 'ok' | 'unknown' = HAS_PAYMENT_CREDENTIALS ? 'ok' : 'unknown'
  const otpSecurityReportFlag = flagStatus(otpSecurityReportFlagResult)
  const otpSecurityReportConfig = otpSecurityReportConfigStatus(otpSecurityReportFlag)

  const auth = {
    otp_whatsapp_flag: flagStatus(otpFlagResult),
    otp_security_report_flag: otpSecurityReportFlag,
    otp_security_report_config: otpSecurityReportConfig,
    supabase_env_complete: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  }

  if (dbOk && otpSecurityReportConfig !== 'missing_otp_hash_pepper') {
    return NextResponse.json(
      { status: 'ok', db: 'ok', whatsapp, payments, auth, timestamp, build },
      { status: 200 },
    )
  }
  return NextResponse.json(
    { status: 'degraded', db: dbOk ? 'ok' : 'error', whatsapp, payments, auth, timestamp, build },
    { status: 503 },
  )
}
