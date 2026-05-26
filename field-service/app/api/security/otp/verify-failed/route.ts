import { NextResponse, type NextRequest } from 'next/server'
import { isEnabled } from '@/lib/flags'
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

export async function POST(request: NextRequest) {
  const phoneE164 = await readPhoneE164(request)
  if (!phoneE164) return genericSuccess()

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
