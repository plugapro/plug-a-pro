import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { normalizePhone } from '@/lib/utils'
import {
  createTraceId,
  maskPhone,
  safeErrorMessage,
  timestamp,
  type DiagnosticCode,
} from '@/lib/support-diagnostics'

const STEP = 'Worker portal send-code'

function reasonFor(code: DiagnosticCode) {
  switch (code) {
    case 'INVALID_PHONE_NUMBER':
      return 'The mobile number format is invalid. Use a South African mobile number such as 0823035070.'
    case 'PROVIDER_NOT_FOUND':
      return 'No active provider account was found for this mobile number.'
    case 'RATE_LIMITED':
      return 'Too many login code requests were made. Please wait a few minutes and try again.'
    case 'OTP_PROVIDER_UNAVAILABLE':
      return 'The OTP provider is temporarily unavailable or phone login is not enabled.'
    case 'OTP_DELIVERY_FAILED':
      return 'WhatsApp/SMS OTP delivery failed.'
    default:
      return 'An unexpected authentication error occurred.'
  }
}

function errorPayload(params: {
  code: DiagnosticCode
  traceId: string
  phone?: string
  providerId?: string
  status: number
}) {
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
        phoneMasked: maskPhone(params.phone),
        providerId: params.providerId,
      },
    },
    { status: params.status },
  )
}

function classifyOtpError(message: string): DiagnosticCode {
  const lower = message.toLowerCase()
  if (lower.includes('rate') || lower.includes('limit') || lower.includes('too many')) {
    return 'RATE_LIMITED'
  }
  if (
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

export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') || createTraceId('auth')
  let rawPhone = ''
  let phone = ''
  let providerId: string | undefined

  try {
    const body = await request.json().catch(() => ({})) as { phone?: string }
    rawPhone = body.phone ?? ''
    phone = normalizePhone(rawPhone)

    if (!/^\+\d{10,15}$/.test(phone)) {
      console.warn('[provider-send-code] invalid phone', {
        traceId,
        rawPhone,
        normalizedPhone: phone,
        step: STEP,
      })
      return errorPayload({ code: 'INVALID_PHONE_NUMBER', traceId, phone: rawPhone, status: 400 })
    }

    const provider = await db.provider.findUnique({
      where: { phone },
      select: { id: true, active: true },
    })
    providerId = provider?.id

    if (!provider?.active) {
      console.warn('[provider-send-code] provider not found or inactive', {
        traceId,
        normalizedPhone: phone,
        providerId,
        active: provider?.active ?? null,
        step: STEP,
      })
      return errorPayload({ code: 'PROVIDER_NOT_FOUND', traceId, phone, providerId, status: 404 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[provider-send-code] Supabase client env missing', {
        traceId,
        providerId,
        normalizedPhone: phone,
        step: STEP,
      })
      return errorPayload({ code: 'OTP_PROVIDER_UNAVAILABLE', traceId, phone, providerId, status: 503 })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const { error } = await supabase.auth.signInWithOtp({ phone })

    if (error) {
      const code = classifyOtpError(error.message)
      console.error('[provider-send-code] OTP send failed', {
        traceId,
        providerId,
        normalizedPhone: phone,
        code,
        otpError: error,
        step: STEP,
      })
      return errorPayload({
        code,
        traceId,
        phone,
        providerId,
        status: code === 'RATE_LIMITED' ? 429 : 502,
      })
    }

    console.info('[provider-send-code] OTP sent', {
      traceId,
      providerId,
      normalizedPhone: phone,
      step: STEP,
    })
    return NextResponse.json({ ok: true, phone, traceId })
  } catch (error) {
    console.error('[provider-send-code] unexpected error', {
      traceId,
      providerId,
      normalizedPhone: phone || normalizePhone(rawPhone),
      error,
      message: safeErrorMessage(error),
      step: STEP,
    })
    return errorPayload({
      code: 'UNKNOWN_AUTH_ERROR',
      traceId,
      phone: phone || rawPhone,
      providerId,
      status: 500,
    })
  }
}
