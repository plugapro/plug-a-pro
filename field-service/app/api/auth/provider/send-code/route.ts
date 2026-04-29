import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/utils'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import {
  createTraceId,
  maskPhone,
  safeErrorMessage,
  timestamp,
  type DiagnosticCode,
} from '@/lib/support-diagnostics'

const STEP = 'Worker portal send-code'
const OTP_TIMEOUT_MS = 10_000

function reasonFor(code: DiagnosticCode) {
  switch (code) {
    case 'INVALID_PHONE_NUMBER':
      return 'Enter a valid South African mobile number.'
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Only South African mobile numbers are enabled for worker portal OTP sign-in.'
    case 'PROVIDER_NOT_FOUND':
      return 'No provider account was found for this mobile number.'
    case 'PROVIDER_INACTIVE':
      return 'This provider account is not active yet.'
    case 'RATE_LIMITED':
      return 'Too many login code requests were made. Please wait a few minutes and try again.'
    case 'OTP_PROVIDER_TIMEOUT':
      return 'OTP delivery timed out.'
    case 'OTP_PROVIDER_UNAVAILABLE':
      return 'The OTP provider is temporarily unavailable or phone login is not enabled.'
    case 'OTP_PROVIDER_BAD_RESPONSE':
      return 'The OTP provider returned an invalid response.'
    case 'OTP_DELIVERY_FAILED':
      return 'OTP delivery failed.'
    default:
      return 'An unexpected authentication error occurred.'
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

  return NextResponse.json(
    {
      ok: false,
      error: {
        title: "We couldn't send your login code.",
        reason: reasonFor(params.code),
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
        code: normalized.errorCode,
        traceId,
        phone: rawPhone,
        countryCode: normalized.countryCode,
        status: normalized.errorCode === 'UNSUPPORTED_COUNTRY_CODE' ? 400 : 422,
      })
    }

    phone = normalized.e164
    countryCode = normalized.countryCode

    const provider = await db.provider.findUnique({
      where: { phone },
      select: { id: true, active: true, status: true },
    })
    providerId = provider?.id

    if (!provider) {
      console.warn('[provider-send-code] provider not found', {
        trace_id: traceId,
        rawPhone,
        normalizedPhone: phone,
        countryCode,
        providerLookupResult: 'not_found',
        providerId: null,
        otpProviderCalled,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({ code: 'PROVIDER_NOT_FOUND', traceId, phone, countryCode, status: 404 })
    }

    if (!provider.active || provider.status !== 'ACTIVE') {
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
        code: 'PROVIDER_INACTIVE',
        traceId,
        phone,
        countryCode,
        providerId,
        status: 403,
      })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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
        code: 'OTP_PROVIDER_UNAVAILABLE',
        traceId,
        phone,
        countryCode,
        providerId,
        status: 503,
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
        code: 'OTP_PROVIDER_BAD_RESPONSE',
        traceId,
        phone,
        countryCode,
        providerId,
        status: 502,
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
        status: code === 'RATE_LIMITED' ? 429 : code === 'OTP_PROVIDER_TIMEOUT' ? 504 : 502,
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
    return NextResponse.json({ ok: true, phone, traceId })
  } catch (error) {
    const code = otpProviderCalled ? classifyOtpError(error) : 'UNKNOWN_AUTH_ERROR'
    console.error('[provider-send-code] unexpected error', {
      trace_id: traceId,
      rawPhone,
      providerId,
      normalizedPhone: phone || normalizePhone(rawPhone),
      countryCode,
      providerLookupResult: providerId ? 'found' : 'unknown',
      otpProviderCalled,
      otpProviderStatus: otpProviderCalled ? code : 'not_called_or_unknown',
      error,
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
      status: code === 'OTP_PROVIDER_TIMEOUT' ? 504 : code === 'UNKNOWN_AUTH_ERROR' ? 500 : 502,
    })
  }
}
