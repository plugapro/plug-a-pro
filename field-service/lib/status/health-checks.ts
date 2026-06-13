import { db } from '@/lib/db'
import { isEnabled, FLAG_KEYS } from '@/lib/flags'

const COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null
const COMMIT_REF = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GIT_COMMIT_REF ?? null
const BUILT_AT = process.env.VERCEL_DEPLOYMENT_CREATED_AT ?? null

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? null
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null

type WhatsAppProbeResult = 'ok' | 'error' | 'unknown'
type FlagStatus = 'enabled' | 'disabled' | 'unknown'
type OtpSecurityReportConfigStatus = 'disabled' | 'ready' | 'missing_otp_hash_pepper' | 'unknown'

const WHATSAPP_PROBE_TTL_MS = 60_000
let _whatsappProbeCache: { value: WhatsAppProbeResult; expiresAt: number } | null = null

async function runWhatsAppProbe(): Promise<WhatsAppProbeResult> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return 'unknown'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, signal: controller.signal },
    )
    clearTimeout(timeout)
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

async function probeWhatsApp(): Promise<WhatsAppProbeResult> {
  const now = Date.now()
  if (_whatsappProbeCache && _whatsappProbeCache.expiresAt > now) return _whatsappProbeCache.value
  const value = await runWhatsAppProbe()
  _whatsappProbeCache = { value, expiresAt: now + WHATSAPP_PROBE_TTL_MS }
  return value
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

export interface FullHealthResult {
  ok: boolean
  status: 'ok' | 'degraded' | 'maintenance'
  db: 'ok' | 'error'
  whatsapp: WhatsAppProbeResult
  payments: 'unknown'
  timestamp: string
  auth: {
    otp_whatsapp_flag: FlagStatus
    otp_security_report_flag: FlagStatus
    otp_security_report_config: OtpSecurityReportConfigStatus
    supabase_env_complete: boolean
  }
  build: { commitSha: string | null; commitShaShort: string | null; commitRef: string | null; builtAt: string | null }
}

function maintenanceModeOn(): boolean {
  const v = process.env.MAINTENANCE_MODE?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

export async function runHealthChecks(): Promise<FullHealthResult> {
  const timestamp = new Date().toISOString()
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

  if (maintenanceModeOn()) {
    return { ok: true, status: 'maintenance', db: dbOk ? 'ok' : 'error', whatsapp, payments: 'unknown', timestamp, auth, build }
  }

  const ok = dbOk
  return {
    ok,
    status: ok ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    whatsapp,
    payments: 'unknown',
    timestamp,
    auth,
    build,
  }
}

export function toPublicHealthBody(full: FullHealthResult) {
  return {
    status: full.status,
    db: full.db,
    whatsapp: full.whatsapp,
    payments: full.payments,
    timestamp: full.timestamp,
  }
}
