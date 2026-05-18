import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { isEnabled, FLAG_KEYS } from '@/lib/flags'
import { verifyStandardWebhookSignature } from '@/lib/supabase-hook-auth'
import { checkOtpSendLimit } from '@/lib/rate-limit'
import { deliverOtp, OtpDeliveryError } from '@/lib/otp-delivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type HookErrorMessage =
  | 'invalid_signature'
  | 'invalid_body'
  | 'otp_whatsapp_disabled'
  | 'rate_limited'
  | 'template_not_approved'
  | 'wa_auth_failed'
  | 'wa_transient'
  | 'unsupported_country'
  | 'invalid_phone'

function errorResponse(httpCode: number, message: HookErrorMessage) {
  return NextResponse.json(
    { error: { http_code: httpCode, message } },
    { status: httpCode },
  )
}

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

export async function POST(request: NextRequest) {
  const hookRequestId = randomUUID()
  const body = await request.text()

  const verification = verifyStandardWebhookSignature({
    body,
    id: request.headers.get('webhook-id'),
    timestamp: request.headers.get('webhook-timestamp'),
    signatureHeader: request.headers.get('webhook-signature'),
  })

  if (!verification.ok) {
    console.warn('[send-sms-hook] signature verification failed', {
      hookRequestId,
      reason: verification.reason,
    })
    return errorResponse(401, 'invalid_signature')
  }

  let parsed: { user?: { id?: string }; sms?: { otp?: string; phone?: string } }
  try {
    parsed = JSON.parse(body)
  } catch {
    return errorResponse(400, 'invalid_body')
  }

  const otp = parsed?.sms?.otp
  const phone = parsed?.sms?.phone
  const userId = parsed?.user?.id ?? null

  if (!otp || !phone) {
    console.warn('[send-sms-hook] missing sms.otp or sms.phone', { hookRequestId })
    return errorResponse(400, 'invalid_body')
  }

  const phoneMasked = phone.length > 6
    ? `${phone.slice(0, 3)}****${phone.slice(-3)}`
    : '***'

  const flagOn = await isEnabled(FLAG_KEYS.AUTH_OTP_WHATSAPP, {
    userId: userId ?? undefined,
  })
  if (!flagOn) {
    console.warn('[send-sms-hook] flag off — whatsapp OTP disabled', {
      message: 'otp_whatsapp_disabled',
      httpCode: 503,
      step: 'send-sms-hook',
      userId,
      phoneMasked,
      timestamp: new Date().toISOString(),
      hookRequestId,
    })
    return errorResponse(503, 'otp_whatsapp_disabled')
  }

  const ip = clientIp(request)
  const rateCheck = await checkOtpSendLimit({
    phone,
    ip,
    context: { surface: 'send_sms_hook', hookRequestId },
  })
  if (!rateCheck.ok) {
    console.warn('[send-sms-hook] rate limited', {
      message: 'rate_limited',
      httpCode: 429,
      step: 'send-sms-hook',
      phoneMasked,
      timestamp: new Date().toISOString(),
      hookRequestId,
      reason: rateCheck.code,
    })
    return errorResponse(429, 'rate_limited')
  }

  try {
    await deliverOtp({
      phone,
      code: otp,
      context: { userId, hookRequestId, traceId: hookRequestId },
    })
    return NextResponse.json({}, { status: 200 })
  } catch (err) {
    if (err instanceof OtpDeliveryError) {
      switch (err.code) {
        case 'TEMPLATE_NOT_APPROVED':
          return errorResponse(503, 'template_not_approved')
        case 'WA_AUTH_FAILED':
          return errorResponse(503, 'wa_auth_failed')
        case 'WA_TRANSIENT':
          return errorResponse(503, 'wa_transient')
        case 'UNSUPPORTED_COUNTRY_CODE':
          return errorResponse(400, 'unsupported_country')
        case 'INVALID_PHONE_NUMBER':
          return errorResponse(400, 'invalid_phone')
      }
    }
    console.error('[send-sms-hook] unexpected error', {
      hookRequestId,
      message: err instanceof Error ? err.message : String(err),
    })
    return errorResponse(503, 'wa_transient')
  }
}
