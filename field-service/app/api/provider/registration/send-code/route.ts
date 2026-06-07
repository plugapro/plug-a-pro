import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createApiReferenceId } from '@/lib/api-response'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { checkPublicProviderSendCodeLimit } from '@/lib/rate-limit'
import { createTraceId, maskPhone, safeErrorMessage, timestamp } from '@/lib/support-diagnostics'

const SURFACE = 'provider_registration_send_code'

function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || null
}

function jsonError(params: {
  code: string
  message: string
  status: number
  traceId: string
  context?: Record<string, unknown>
}) {
  const referenceId = createApiReferenceId('PAP')
  return NextResponse.json(
    {
      ok: false,
      code: params.code,
      message: params.message,
      traceId: params.traceId,
      error: {
        code: params.code,
        category: params.status === 429 ? 'rate_limit' : params.status >= 500 ? 'dependency' : 'validation',
        message: params.message,
        reference_id: referenceId,
        referenceId,
        retryable: params.status === 429 || params.status >= 500,
        suggested_actions: params.status === 429
          ? ['Wait before retrying.']
          : ['Check the mobile number and try again.'],
        context: params.context ?? {},
        timestamp: timestamp(),
      },
    },
    { status: params.status },
  )
}

export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') || createTraceId('reg')

  try {
    const body = await request.json().catch(() => ({})) as {
      phone?: string
      countryCode?: string
    }
    const rawPhone = body.phone ?? ''
    const normalized = normalizeOtpPhoneNumber(rawPhone, body.countryCode ?? 'ZA')

    if (!normalized.ok) {
      return jsonError({
        code: normalized.errorCode === 'INVALID_PHONE_NUMBER' ? 'INVALID_MOBILE_NUMBER' : normalized.errorCode,
        message: normalized.reason,
        status: 422,
        traceId,
        context: { surface: SURFACE, phoneMasked: maskPhone(rawPhone) },
      })
    }

    const rateLimit = await checkPublicProviderSendCodeLimit({
      phone: normalized.e164,
      ip: clientIp(request),
      context: { surface: SURFACE, traceId },
    })
    if (!rateLimit.ok) {
      return jsonError({
        code: rateLimit.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED',
        message: rateLimit.code === 'limiter_unavailable'
          ? "We couldn't send the code right now. Please try again shortly."
          : 'Too many code requests. Please wait before trying again.',
        status: rateLimit.code === 'limiter_unavailable' ? 503 : 429,
        traceId,
        context: { surface: SURFACE, phoneMasked: maskPhone(normalized.e164) },
      })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )

    const { error } = await supabase.auth.signInWithOtp({
      phone: normalized.e164,
      options: { shouldCreateUser: true },
    })

    if (error) {
      console.warn('[provider-registration-send-code] otp provider failed', {
        trace_id: traceId,
        phoneMasked: maskPhone(normalized.e164),
        safeErrorMessage: safeErrorMessage(error),
        timestamp: timestamp(),
      })
      return jsonError({
        code: 'OTP_DELIVERY_FAILED',
        message: "We couldn't send the code right now. Please try again shortly.",
        status: 502,
        traceId,
        context: { surface: SURFACE, phoneMasked: maskPhone(normalized.e164) },
      })
    }

    return NextResponse.json({
      ok: true,
      nextStep: 'otp',
      phone: normalized.e164,
      traceId,
    })
  } catch (error) {
    console.error('[provider-registration-send-code] unexpected error', {
      trace_id: traceId,
      safeErrorMessage: safeErrorMessage(error),
      timestamp: timestamp(),
    })
    return jsonError({
      code: 'REGISTRATION_OTP_SEND_FAILED',
      message: "We couldn't send the code right now. Please try again shortly.",
      status: 500,
      traceId,
      context: { surface: SURFACE },
    })
  }
}
