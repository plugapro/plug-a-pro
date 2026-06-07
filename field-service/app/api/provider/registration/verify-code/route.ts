import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createApiReferenceId } from '@/lib/api-response'
import { buildSessionCookieHeader, resolveSessionMaxAge } from '@/lib/auth-session-cookie'
import { db } from '@/lib/db'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import { findLatestProviderRegistrationApplicationByPhone } from '@/lib/provider-applications'
import { checkOtpVerifyLimit } from '@/lib/rate-limit'
import { createTraceId, maskPhone, safeErrorMessage, timestamp } from '@/lib/support-diagnostics'

const SURFACE = 'provider_registration_verify_code'

type RegistrationState = 'pending' | 'more_info' | 'approved' | 'rejected' | 'cancelled'

function phoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, '')
  return Array.from(new Set([
    phone,
    digits ? `+${digits}` : null,
    digits || null,
    digits.startsWith('27') ? `0${digits.slice(2)}` : null,
  ].filter(Boolean) as string[]))
}

function registrationState(status: string | null | undefined): RegistrationState {
  if (status === 'MORE_INFO_REQUIRED') return 'more_info'
  if (status === 'APPROVED') return 'approved'
  if (status === 'REJECTED') return 'rejected'
  if (status === 'CANCELLED') return 'cancelled'
  return 'pending'
}

function jsonError(params: {
  code: string
  message: string
  status: number
  traceId: string
  retryable?: boolean
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
        retryable: params.retryable ?? (params.status === 429 || params.status >= 500),
        suggested_actions: params.status === 429
          ? ['Wait before retrying.']
          : ['Check the code and try again.'],
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
      code?: string
      token?: string
      countryCode?: string
    }
    const rawPhone = body.phone ?? ''
    const token = (body.code ?? body.token ?? '').trim()
    const normalized = normalizeOtpPhoneNumber(rawPhone, body.countryCode ?? 'ZA')

    if (!normalized.ok || !token) {
      return jsonError({
        code: 'INVALID_OTP',
        message: 'Enter the 6-digit code we sent to your phone.',
        status: 422,
        traceId,
        context: { surface: SURFACE, phoneMasked: maskPhone(rawPhone) },
      })
    }

    const rateLimit = await checkOtpVerifyLimit({
      phone: normalized.e164,
      context: { surface: SURFACE, traceId },
    })
    if (!rateLimit.ok) {
      return jsonError({
        code: rateLimit.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED',
        message: rateLimit.code === 'limiter_unavailable'
          ? "We couldn't verify the code right now. Please try again shortly."
          : 'Too many code attempts. Please wait before trying again.',
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

    const { data, error } = await supabase.auth.verifyOtp({
      phone: normalized.e164,
      token,
      type: 'sms',
    })

    if (error || !data.user || !data.session?.access_token) {
      return jsonError({
        code: 'INVALID_OTP',
        message: 'That code was not accepted. Check it and try again.',
        status: 422,
        traceId,
        retryable: false,
        context: { surface: SURFACE, phoneMasked: maskPhone(normalized.e164) },
      })
    }

    const customer = await db.customer.findFirst({
      where: { phone: { in: phoneVariants(normalized.e164) } },
      select: { id: true },
    })
    if (customer) {
      return NextResponse.json({
        ok: true,
        nextStep: 'conflict',
        reason: 'phone_is_customer',
        phone: normalized.e164,
        traceId,
      })
    }

    const application = await findLatestProviderRegistrationApplicationByPhone(db, normalized.e164).catch(() => null)
    const maxAge = resolveSessionMaxAge(data.session.expires_in)
    const response = NextResponse.json({
      ok: true,
      nextStep: application ? 'status' : 'profile',
      redirectTo: application ? '/provider/register/status' : '/provider/register/profile',
      state: application ? registrationState(application.status) : null,
      phone: normalized.e164,
      traceId,
    })
    response.headers.set('Set-Cookie', buildSessionCookieHeader(data.session.access_token, maxAge))
    return response
  } catch (error) {
    console.error('[provider-registration-verify-code] unexpected error', {
      trace_id: traceId,
      safeErrorMessage: safeErrorMessage(error),
      timestamp: timestamp(),
    })
    return jsonError({
      code: 'REGISTRATION_OTP_VERIFY_FAILED',
      message: "We couldn't verify the code right now. Please try again shortly.",
      status: 500,
      traceId,
      context: { surface: SURFACE },
    })
  }
}
