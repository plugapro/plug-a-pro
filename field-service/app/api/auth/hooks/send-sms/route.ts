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
import { shouldSendSecurityCheck } from '@/lib/otp-security-signals'
import { sendOtpSecurityCheckBestEffort } from '@/lib/otp-security-report-prompt'

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

function deliveryErrorResponse(err: unknown, hookRequestId: string) {
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

async function markSentBestEffort(params: {
  challengeId: string
  whatsappMessageId: string | null
  hookRequestId: string
}): Promise<void> {
  try {
    await markChallengeSent(params.challengeId, params.whatsappMessageId)
  } catch (err) {
    console.warn('[send-sms-hook] challenge sent update failed', {
      hookRequestId: params.hookRequestId,
      challengeId: params.challengeId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

async function markFailedBestEffort(params: {
  challengeId: string
  hookRequestId: string
}): Promise<void> {
  try {
    await markChallengeSendFailed(params.challengeId)
  } catch (err) {
    console.warn('[send-sms-hook] challenge failed update failed', {
      hookRequestId: params.hookRequestId,
      challengeId: params.challengeId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
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

  // reportToken is delivered via the SEPARATE `otp_security_check` UTILITY
  // template after the OTP send succeeds — see the signal-gated block below.
  // Do not inject the token into otp_login; that AUTHENTICATION template's
  // URL button parameter MUST equal the OTP code (Meta error #131008).

  let delivery: Awaited<ReturnType<typeof deliverOtp>>
  try {
    delivery = await deliverOtp({
      phone,
      code: otp,
      context: { userId, hookRequestId, traceId: hookRequestId },
    })
  } catch (err) {
    if (challengeId) {
      await markFailedBestEffort({ challengeId, hookRequestId })
    }
    return deliveryErrorResponse(err, hookRequestId)
  }

  if (challengeId) {
    await markSentBestEffort({
      challengeId,
      whatsappMessageId: delivery.whatsappMessageId ?? null,
      hookRequestId,
    })
  }

  // Phase-2: signal-gated security check prompt. Detached via Next.js after()
  // so the response returns to Supabase IMMEDIATELY — the signal evaluation
  // and template send happen post-response. Without this, the phase-2 block
  // could add up to ~4.5s of signal-eval latency + ~10s of Meta-API latency
  // BEFORE the hook returns 200, easily exceeding Supabase's ~5s auth-hook
  // timeout. A timed-out hook causes Supabase to retry the OTP send, which
  // would double-record challenges and deliver two otp_login messages to
  // the user. The OTP delivery above is already complete; the security
  // check is a best-effort follow-up that MUST NOT block the response.
  if (securityOn && reportToken) {
    const phaseTwoWork = async () => {
      try {
        const signal = await shouldSendSecurityCheck({ phoneE164: phone })
        if (signal.trigger) {
          await sendOtpSecurityCheckBestEffort({
            phone,
            reportToken: reportToken!,
            trigger: signal.trigger,
            hookRequestId,
            userId,
          })
        }
      } catch (err) {
        // shouldSendSecurityCheck and sendOtpSecurityCheckBestEffort both fail
        // closed already, but defence in depth: never propagate.
        console.warn(
          JSON.stringify({
            event: 'otp.security_check.evaluation_failed',
            hookRequestId,
            phoneMasked,
            reason: err instanceof Error ? err.name : 'unknown',
          }),
        )
      }
    }

    try {
      const { after } = await import('next/server')
      after(phaseTwoWork)
    } catch {
      // after() not available in this execution context (nested in another
      // after() callback, or a test runtime). Fall back to fire-and-forget;
      // the work still runs but we lose Vercel's guarantee that the runtime
      // stays alive until completion. Acceptable: phase-2 is best-effort.
      void phaseTwoWork()
    }
  }

  return NextResponse.json({}, { status: 200 })
}
