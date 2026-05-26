import { NextResponse, type NextRequest } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { reportUnrequestedOtp } from '@/lib/otp-security'
import { checkOtpReportLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function genericSuccess() {
  return NextResponse.json({ ok: true })
}

async function readReportToken(request: NextRequest): Promise<string | undefined> {
  const body = await request.json().catch(() => ({})) as { token?: unknown }
  return typeof body.token === 'string' ? body.token : undefined
}

export async function POST(request: NextRequest) {
  const token = await readReportToken(request)
  const enabled = await isEnabled('security.otp.report').catch(() => false)
  if (!enabled) return genericSuccess()

  const ip = trustedClientIp(request)
  const ua = request.headers.get('user-agent')
  const limit = await checkOtpReportLimit({ ip, ua })
  if (!limit.ok) return genericSuccess()

  await reportUnrequestedOtp({
    token,
    sourceChannel: 'PWA_LINK',
    ip,
    ua,
  }).catch(() => undefined)

  return genericSuccess()
}
