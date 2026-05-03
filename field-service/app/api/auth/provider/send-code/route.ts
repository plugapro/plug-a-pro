import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import {
  createTraceId,
  maskPhone,
  safeErrorMessage,
  timestamp,
  type DiagnosticCode,
} from '@/lib/support-diagnostics'
import { checkWorkerPortalAccess, findProviderForOtpLogin } from '@/lib/worker-provider-auth'

const STEP = 'Worker portal send-code'
const OTP_TIMEOUT_MS = 10_000

function reasonFor(code: DiagnosticCode) {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
      return 'Enter a valid South African mobile number.'
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Only South African mobile numbers are enabled for worker portal OTP sign-in.'
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return "We couldn't find a provider account for this number. Please register first or contact support."
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return 'Your provider application must be approved before you can sign in to the Worker Portal.'
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 'This provider account is not active.'
    case 'RATE_LIMITED':
      return 'Too many login code requests were made. Please wait a few minutes and try again.'
    case 'OTP_PROVIDER_TIMEOUT':
      return 'OTP delivery timed out.'
    case 'AUTH_CONFIG_MISSING':
    case 'AUTH_RESPONSE_INVALID':
    case 'OTP_PROVIDER_UNAVAILABLE':
      return "We couldn't send the code right now. Please try again shortly."
    case 'OTP_PROVIDER_BAD_RESPONSE':
      return "We couldn't send the code right now. Please try again shortly."
    case 'OTP_PROVIDER_AUTH_FAILED':
      return "We couldn't send the code right now. Please try again shortly."
    case 'OTP_DELIVERY_FAILED':
      return "We couldn't send the code right now. Please try again shortly."
    default:
      return 'An unexpected authentication error occurred.'
  }
}

function titleFor(code: DiagnosticCode) {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Check the mobile number.'
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return 'Provider account not found.'
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return 'Application still under review.'
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 'Provider account inactive.'
    case 'RATE_LIMITED':
      return 'Please wait before trying again.'
    default:
      return "We couldn't send your login code."
  }
}

function statusFor(code: DiagnosticCode) {
  switch (code) {
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 400
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
      return 422
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return 404
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return 403
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 423
    case 'RATE_LIMITED':
      return 429
    case 'AUTH_CONFIG_MISSING':
    case 'OTP_PROVIDER_UNAVAILABLE':
      return 503
    case 'OTP_PROVIDER_TIMEOUT':
      return 504
    case 'OTP_PROVIDER_AUTH_FAILED':
      return 401
    case 'AUTH_RESPONSE_INVALID':
    case 'OTP_PROVIDER_BAD_RESPONSE':
    case 'OTP_DELIVERY_FAILED':
      return 502
    default:
      return 500
  }
}

function errorPayload(params: {
  code: DiagnosticCode
  traceId: string
  phone?: string
  countryCode?: string
  providerId?: string
  status: number
}) {
  const checkedPhone = params.phone && /^\+\d{10,15}$/.test(params.phone)
    ? params.phone
    : undefined

  const message = reasonFor(params.code)
  return NextResponse.json(
    {
      ok: false,
      code: params.code,
      message,
      traceId: params.traceId,
      error: {
        title: titleFor(params.code),
        reason: message,
        code: params.code,
        step: STEP,
        traceId: params.traceId,
        time: timestamp(),
        mobileChecked: checkedPhone,
        phoneMasked: maskPhone(params.phone),
        countryCode: params.countryCode,
        providerId: params.providerId,
      },
    },
    { status: params.status },
  )
}

function classifyOtpError(error: unknown): DiagnosticCode {
  const lower = safeErrorMessage(error).toLowerCase()
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('etimedout')
  ) {
    return 'OTP_PROVIDER_TIMEOUT'
  }
  if (lower.includes('rate') || lower.includes('limit') || lower.includes('too many')) {
    return 'RATE_LIMITED'
  }
  if (
    lower.includes('auth') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid key') ||
    lower.includes('jwt') ||
    lower.includes('apikey') ||
    lower.includes('api key')
  ) {
    return 'OTP_PROVIDER_AUTH_FAILED'
  }
  if (
    lower.includes('bad response') ||
    lower.includes('invalid response') ||
    lower.includes('malformed') ||
    lower.includes('parse')
  ) {
    return 'OTP_PROVIDER_BAD_RESPONSE'
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('network') ||
    lower.includes('fetch failed') ||
    lower.includes('econn') ||
    lower.includes('unsupported') ||
    lower.includes('not enabled') ||
    lower.includes('provider') ||
    lower.includes('sms') ||
    lower.includes('phone')
  ) {
    return 'OTP_PROVIDER_UNAVAILABLE'
  }
  return 'OTP_DELIVERY_FAILED'
}

async function withOtpTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`OTP provider timed out after ${OTP_TIMEOUT_MS}ms`))
        }, OTP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function POST(request: NextRequest) {
  const headerTraceId = request.headers.get('x-trace-id')
  let traceId = headerTraceId || createTraceId('auth')
  let rawPhone = ''
  let phone = ''
  let countryCode = 'ZA'
  let providerId: string | undefined
  let otpProviderCalled = false
  let otpSetupStarted = false

  try {
    const body = await request.json().catch(() => ({})) as {
      phone?: string
      countryCode?: string
      traceId?: string
    }
    traceId = body.traceId || traceId
    rawPhone = body.phone ?? ''
    countryCode = body.countryCode ?? countryCode
    const normalized = normalizeOtpPhoneNumber(rawPhone, countryCode)

    if (!normalized.ok) {
      console.warn('[provider-send-code] invalid phone', {
        trace_id: traceId,
        rawPhone,
        normalizedPhone: null,
        countryCode: normalized.countryCode,
        providerLookupResult: 'not_called',
        otpProviderCalled,
        safeErrorMessage: normalized.reason,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: normalized.errorCode === 'INVALID_PHONE_NUMBER' ? 'INVALID_MOBILE_NUMBER' : normalized.errorCode,
        traceId,
        phone: rawPhone,
        countryCode: normalized.countryCode,
        status: statusFor(normalized.errorCode === 'INVALID_PHONE_NUMBER' ? 'INVALID_MOBILE_NUMBER' : normalized.errorCode),
      })
    }

    phone = normalized.e164
    countryCode = normalized.countryCode

    let provider: { id: string; userId: string | null; phone: string; active: boolean; verified: boolean; status: string } | null
    try {
      const lookupResult = await findProviderForOtpLogin(phone, rawPhone, db)
      if (!lookupResult.found) {
        const hasPendingApp = Boolean(lookupResult.pendingApplicationId)
        console.warn('[provider-send-code] provider not found', {
          trace_id: traceId,
          rawPhone,
          normalizedPhone: phone,
          countryCode,
          providerLookupResult: hasPendingApp ? 'pending_application' : 'not_found',
          pendingApplicationId: lookupResult.pendingApplicationId ?? null,
          pendingApplicationStatus: lookupResult.pendingApplicationStatus ?? null,
          providerId: null,
          otpProviderCalled,
          timestamp: timestamp(),
          step: STEP,
        })
        if (hasPendingApp) {
          return errorPayload({ code: 'WORKER_NOT_APPROVED', traceId, phone, countryCode, status: statusFor('WORKER_NOT_APPROVED') })
        }
        return errorPayload({ code: 'WORKER_NOT_FOUND', traceId, phone, countryCode, status: statusFor('WORKER_NOT_FOUND') })
      }
      provider = lookupResult.provider
    } catch (dbError) {
      console.error('[provider-send-code] provider lookup failed', {
        trace_id: traceId,
        rawPhone,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'db_error',
        otpProviderCalled,
        safeErrorMessage: safeErrorMessage(dbError),
        stack: dbError instanceof Error ? dbError.stack : undefined,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: 'OTP_PROVIDER_UNAVAILABLE',
        traceId,
        phone,
        countryCode,
        status: 503,
      })
    }
    providerId = provider?.id

    const access = checkWorkerPortalAccess(provider)

    if (!access.ok && access.code === 'WORKER_NOT_APPROVED') {
      console.warn('[provider-send-code] provider not approved', {
        trace_id: traceId,
        rawPhone,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'found_not_approved',
        providerId,
        active: provider.active,
        providerStatus: provider.status,
        otpProviderCalled,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: 'WORKER_NOT_APPROVED',
        traceId,
        phone,
        countryCode,
        providerId,
        status: 403,
      })
    }

    if (!access.ok) {
      console.warn('[provider-send-code] provider inactive', {
        trace_id: traceId,
        rawPhone,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'found_inactive',
        providerId,
        active: provider.active,
        providerStatus: provider.status,
        otpProviderCalled,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: 'WORKER_INACTIVE',
        traceId,
        phone,
        countryCode,
        providerId,
        status: 423,
      })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    otpSetupStarted = true
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[provider-send-code] Supabase client env missing', {
        trace_id: traceId,
        rawPhone,
        providerId,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'found_active',
        otpProviderCalled,
        otpProviderStatus: 'not_configured',
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: 'AUTH_CONFIG_MISSING',
        traceId,
        phone,
        countryCode,
        providerId,
        status: statusFor('AUTH_CONFIG_MISSING'),
      })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    otpProviderCalled = true
    const response = await withOtpTimeout(supabase.auth.signInWithOtp({ phone }))

    if (!response || typeof response !== 'object' || !('error' in response)) {
      console.error('[provider-send-code] OTP provider bad response', {
        trace_id: traceId,
        rawPhone,
        providerId,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'found_active',
        otpProviderCalled,
        otpProviderStatus: 'bad_response',
        safeErrorMessage: 'OTP provider did not return an object with an error field.',
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: 'AUTH_RESPONSE_INVALID',
        traceId,
        phone,
        countryCode,
        providerId,
        status: statusFor('AUTH_RESPONSE_INVALID'),
      })
    }

    const { error } = response as { error?: unknown }

    if (error) {
      const code = classifyOtpError(error)
      console.error('[provider-send-code] OTP send failed', {
        trace_id: traceId,
        rawPhone,
        providerId,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'found_active',
        otpProviderCalled,
        otpProviderStatus: code,
        code,
        safeErrorMessage: safeErrorMessage(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code,
        traceId,
        phone,
        countryCode,
        providerId,
        status: statusFor(code),
      })
    }

    console.info('[provider-send-code] OTP sent', {
      trace_id: traceId,
      rawPhone,
      providerId,
      normalizedPhone: phone,
      countryCode,
      providerLookupResult: 'found_active',
      otpProviderCalled,
      otpProviderStatus: 'sent',
      timestamp: timestamp(),
      step: STEP,
    })
    return NextResponse.json({ ok: true, nextStep: 'verify_otp', phone, traceId })
  } catch (error) {
    const code = otpProviderCalled
      ? classifyOtpError(error)
      : otpSetupStarted
        ? 'AUTH_CONFIG_MISSING'
        : 'AUTH_RESPONSE_INVALID'
    console.error('[provider-send-code] unexpected error', {
      trace_id: traceId,
      rawPhone,
      providerId,
      normalizedPhone: phone || rawPhone,
      countryCode,
      providerLookupResult: providerId ? 'found' : 'unknown',
      otpProviderCalled,
      otpProviderStatus: otpProviderCalled ? code : 'not_called_or_unknown',
      safeErrorMessage: safeErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: timestamp(),
      step: STEP,
    })
    return errorPayload({
      code,
      traceId,
      phone: phone || rawPhone,
      countryCode,
      providerId,
      status: statusFor(code),
    })
  }
}
