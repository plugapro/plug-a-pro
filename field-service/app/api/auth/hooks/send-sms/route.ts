import { NextResponse, type NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { isEnabled, FLAG_KEYS } from '@/lib/flags'
import { verifyStandardWebhookSignature } from '@/lib/supabase-hook-auth'
import { checkOtpSendLimit } from '@/lib/rate-limit'
import { deliverOtp, OtpDeliveryError } from '@/lib/otp-delivery'
import { trustedClientIp } from '@/lib/request-ip'
import {
  isDeliveryAllowed,
  markChallengeCancelled,
  markChallengeSendFailed,
  markChallengeSent,
  recordDeliveryRefusedDuringLock,
  recordOtpChallenge,
} from '@/lib/otp-security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type HookErrorMessage =
  | 'invalid_signature'
  | 'invalid_body'
  | 'otp_whatsapp_disabled'
  | 'rate_limited'
  | 'rate_limit_unavailable'
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
    console.warn('[send-sms-hook] flag off - whatsapp OTP disabled', {
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

  const ip = trustedClientIp(request)
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
    return rateCheck.code === 'limiter_unavailable'
      ? errorResponse(503, 'rate_limit_unavailable')
      : errorResponse(429, 'rate_limited')
  }

  const securityOn = await isEnabled('security.otp.report', {
    userId: userId ?? undefined,
  })
  const ua = request.headers.get('user-agent')
  let challengeId: string | null = null
  let reportToken: string | null = null

  if (securityOn) {
    const challenge = await recordOtpChallenge({
      phoneE164: phone,
      userId,
      purpose: 'LOGIN',
      code: otp,
      ip,
      ua,
      context: {
        traceId: hookRequestId,
        hookRequestId,
        source: 'send_sms_hook',
      },
    })
    challengeId = challenge.challengeId
    reportToken = challenge.reportToken

    const deliveryAllowed = await isDeliveryAllowed(phone)
    if (!deliveryAllowed.allowed) {
      await recordDeliveryRefusedDuringLock({
        phoneE164: phone,
        userId,
        challengeId,
        ip,
        ua,
      })
      await markChallengeCancelled(challengeId, 'delivery_refused_during_lock')
      return NextResponse.json({}, { status: 200 })
    }
  }

  // reportToken is persisted for the separate security template / deep-link path.
  // Do not inject it into otp_login; that Meta authentication template stays unchanged.
  void reportToken

  try {
    const delivery = await deliverOtp({
      phone,
      code: otp,
      context: { userId, hookRequestId, traceId: hookRequestId },
    })
    if (challengeId) {
      await markChallengeSent(challengeId, delivery.whatsappMessageId ?? null)
    }
    return NextResponse.json({}, { status: 200 })
  } catch (err) {
    if (challengeId) {
      await markChallengeSendFailed(challengeId)
    }
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
