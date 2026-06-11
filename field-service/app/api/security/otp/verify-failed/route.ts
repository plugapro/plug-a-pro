import { NextResponse, type NextRequest } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { getSession } from '@/lib/auth'
import { checkOtpVerifyLimit, recordVerificationResult } from '@/lib/otp-security'
import { trustedClientIp } from '@/lib/request-ip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function genericSuccess() {
  return NextResponse.json({ ok: true })
}

async function readPhoneE164(request: NextRequest): Promise<string> {
  const body = await request.json().catch(() => ({})) as { phoneE164?: unknown }
  return typeof body.phoneE164 === 'string' ? body.phoneE164.trim() : ''
}

// SECURITY (finding d3930a40): this telemetry endpoint calls checkOtpVerifyLimit(),
// which immediately CONSUMES the shared verifyByPhone bucket. An unauthenticated
// caller who knows a provider's phone number could otherwise spam this endpoint to
// exhaust OTP_VERIFY_LIMIT_PER_PHONE_HOUR and lock out legitimate OTP verification.
// We therefore only let an authenticated session or a CRON_SECRET-bearing caller
// reach the bucket-consuming path. The proxy already keeps this route behind the
// session gate; this is defence in depth in case the path is reached otherwise.
async function isTrustedCaller(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true
  }
  const session = await getSession().catch(() => null)
  return Boolean(session)
}

export async function POST(request: NextRequest) {
  const phoneE164 = await readPhoneE164(request)
  if (!phoneE164) return genericSuccess()

  // Reject unauthenticated callers without consuming any rate-limit bucket. We
  // return the same generic success shape so the endpoint stays non-enumerating.
  if (!(await isTrustedCaller(request))) return genericSuccess()

  const enabled = await isEnabled('security.otp.report').catch(() => false)
  if (!enabled) return genericSuccess()

  try {
    const limit = await checkOtpVerifyLimit({
      phoneE164,
      ip: trustedClientIp(request),
      ua: request.headers.get('user-agent'),
    })

    if (limit.ok) {
      await recordVerificationResult({
        phoneE164,
        success: false,
        source: 'client_telemetry',
      }).catch(() => undefined)
    }
  } catch {
    return genericSuccess()
  }

  return genericSuccess()
}
