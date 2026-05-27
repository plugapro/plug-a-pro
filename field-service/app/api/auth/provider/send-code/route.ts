import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { createServiceClient } from '@/lib/auth'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import {
  createTraceId,
  maskPhone,
  safeErrorMessage,
  timestamp,
  type DiagnosticCode,
} from '@/lib/support-diagnostics'
import { checkWorkerPortalAccess, findProviderForOtpLogin } from '@/lib/worker-provider-auth'
import {
  checkOtpSendLimit,
  checkProviderLookupLimit,
  checkPublicProviderSendCodeLimit,
} from '@/lib/rate-limit'
import { createApiReferenceId } from '@/lib/api-response'

const STEP = 'Worker portal send-code'
const OTP_TIMEOUT_MS = 10_000
const BOT_CHECK_MIN_AGE_MS = 500
const BOT_CHECK_MAX_AGE_MS = 10 * 60 * 1000

type ProviderOtpBotCheck = {
  startedAt?: number
  website?: string
}

type ProviderLookupLogResult =
  | 'not_called'
  | 'not_found'
  | 'pending_application'
  | 'db_error'
  | 'found_active'
  | 'found_not_approved'
  | 'found_inactive'
  | 'unknown'

function otpStartPayload(params: {
  traceId: string
  phone: string
}) {
  return NextResponse.json({
    ok: true,
    nextStep: 'verify_otp',
    phone: params.phone,
    traceId: params.traceId,
  })
}

function reasonFor(code: DiagnosticCode) {
  switch (code) {
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
      return 'Enter a valid South African mobile number.'
    case 'UNSUPPORTED_COUNTRY_CODE':
      return 'Only South African mobile numbers are enabled for worker portal OTP sign-in.'
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return "We couldn't find a provider account for this number. If you're trying to view your customer bookings, sign in as a customer instead."
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return 'Your provider application must be approved before you can sign in to the Worker Portal.'
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return 'This provider account is not active.'
    case 'RATE_LIMITED':
      return 'Too many login code requests were made. Please wait a few minutes and try again.'
    case 'BOT_CHECK_FAILED':
      return "We couldn't verify this sign-in request. Please refresh the page and try again."
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
    case 'BOT_CHECK_FAILED':
      return 'Refresh and try again.'
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
    case 'BOT_CHECK_FAILED':
      return 403
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

function categoryFor(status: number) {
  if (status === 401) return 'authentication'
  if (status === 403) return 'authorization'
  if (status === 422 || status === 400) return 'validation'
  if (status === 423) return 'account_state'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'dependency'
  return 'request'
}

function suggestedActionsFor(code: DiagnosticCode) {
  switch (code) {
    case 'BOT_CHECK_FAILED':
      return ['Refresh the page and try again.']
    case 'RATE_LIMITED':
      return ['Wait a few minutes before trying again.']
    case 'INVALID_MOBILE_NUMBER':
    case 'INVALID_PHONE_NUMBER':
    case 'UNSUPPORTED_COUNTRY_CODE':
      return ['Check the mobile number and try again.']
    case 'WORKER_NOT_FOUND':
    case 'PROVIDER_NOT_FOUND':
      return ['Use customer sign-in, apply as a provider, or contact support.']
    case 'WORKER_NOT_APPROVED':
    case 'PROVIDER_NOT_APPROVED':
      return ['Wait for approval or contact support.']
    case 'WORKER_INACTIVE':
    case 'PROVIDER_INACTIVE':
      return ['Contact support.']
    default:
      return ['Try again shortly or contact support with the reference ID.']
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
  const message = reasonFor(params.code)
  const referenceId = createApiReferenceId()
  return NextResponse.json(
    {
      ok: false,
      code: params.code,
      message,
      traceId: params.traceId,
      error: {
        category: categoryFor(params.status),
        title: titleFor(params.code),
        reason: message,
        message,
        code: params.code,
        reference_id: referenceId,
        referenceId,
        retryable: params.status === 408 || params.status === 429 || params.status >= 500,
        suggested_actions: suggestedActionsFor(params.code),
        context: { surface: 'provider_send_code', step: STEP },
        timestamp: timestamp(),
        step: STEP,
        traceId: params.traceId,
        time: timestamp(),
        phoneMasked: maskPhone(params.phone),
        countryCode: params.countryCode,
        providerId: params.providerId,
      },
    },
    { status: params.status },
  )
}

function providerOtpBotCheckRequired() {
  if (process.env.PROVIDER_OTP_BOT_CHECK_REQUIRED === 'true') return true
  if (process.env.PROVIDER_OTP_BOT_CHECK_REQUIRED === 'false') return false
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

function validateProviderOtpBotCheck(botCheck: ProviderOtpBotCheck | undefined) {
  if (!providerOtpBotCheckRequired()) return { ok: true as const }
  if (!botCheck || typeof botCheck !== 'object') return { ok: false as const, reason: 'missing' }
  if (typeof botCheck.website === 'string' && botCheck.website.trim() !== '') {
    return { ok: false as const, reason: 'honeypot' }
  }
  if (typeof botCheck.startedAt !== 'number' || !Number.isFinite(botCheck.startedAt)) {
    return { ok: false as const, reason: 'invalid_started_at' }
  }
  const ageMs = Date.now() - botCheck.startedAt
  if (ageMs < BOT_CHECK_MIN_AGE_MS || ageMs > BOT_CHECK_MAX_AGE_MS) {
    return { ok: false as const, reason: 'stale_or_future' }
  }
  return { ok: true as const }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phoneRedactionVariants(phone: string | null | undefined) {
  if (!phone) return []
  const variants = new Set<string>()
  const trimmed = phone.trim()
  if (trimmed) variants.add(trimmed)

  const digits = phone.replace(/\D/g, '')
  if (!digits) return [...variants]

  variants.add(digits)
  variants.add(`+${digits}`)
  if (digits.startsWith('27') && digits.length > 2) {
    variants.add(`0${digits.slice(2)}`)
  }
  if (digits.startsWith('0') && digits.length > 1) {
    variants.add(`27${digits.slice(1)}`)
    variants.add(`+27${digits.slice(1)}`)
  }

  return [...variants]
}

function redactPhoneValues(message: string, phones: Array<string | null | undefined>) {
  // Error strings can come from DB/Auth providers, so redact every known phone
  // representation before writing them to logs.
  let redacted = message
  const replacements = new Map<string, string>()

  for (const phone of phones) {
    const masked = maskPhone(phone) ?? '[phone]'
    for (const variant of phoneRedactionVariants(phone)) {
      replacements.set(variant, masked)
    }
  }

  const orderedReplacements = [...replacements.entries()]
    .sort(([left], [right]) => right.length - left.length)

  for (const [variant, masked] of orderedReplacements) {
    redacted = redacted.replace(new RegExp(escapeRegExp(variant), 'g'), masked)
  }

  return redacted
}

function safeLogErrorMessage(error: unknown, phones: Array<string | null | undefined>) {
  return redactPhoneValues(safeErrorMessage(error), phones)
}

function safeLogErrorStack(error: unknown, phones: Array<string | null | undefined>) {
  if (!(error instanceof Error) || !error.stack) return undefined
  return redactPhoneValues(error.stack, phones)
}

/**
 * Tokens emitted by the Supabase Send SMS Hook (`/api/auth/hooks/send-sms`).
 * Supabase Auth wraps these in its own "Error sending sms message" envelope,
 * so the raw token shows up inside the `signInWithOtp` error message.
 * Detecting them by token lets us map a single opaque OTP_PROVIDER_UNAVAILABLE
 * 503 into a specific operational cause (flag off / template unapproved /
 * WhatsApp creds invalid / transient delivery failure).
 */
function classifyHookToken(lower: string): DiagnosticCode | null {
  if (lower.includes('otp_whatsapp_disabled')) return 'AUTH_CONFIG_MISSING'
  if (lower.includes('template_not_approved')) return 'AUTH_CONFIG_MISSING'
  if (lower.includes('wa_auth_failed')) return 'OTP_PROVIDER_AUTH_FAILED'
  if (lower.includes('wa_transient')) return 'OTP_DELIVERY_FAILED'
  if (lower.includes('invalid_signature')) return 'AUTH_CONFIG_MISSING'
  if (lower.includes('unsupported_country')) return 'UNSUPPORTED_COUNTRY_CODE'
  return null
}

function classifyOtpError(error: unknown): DiagnosticCode {
  const lower = safeErrorMessage(error).toLowerCase()

  const fromHook = classifyHookToken(lower)
  if (fromHook) return fromHook

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
    lower.includes('not enabled') ||
    lower.includes('signups are disabled') ||
    lower.includes('signups not allowed') ||
    lower.includes('phone provider')
  ) {
    return 'OTP_PROVIDER_UNAVAILABLE'
  }
  // Generic Supabase "Error sending sms message" / "error sending phone otp"
  // without any of the more specific markers above → treat as delivery failure
  // (502, retry-able) rather than provider-down (503).
  if (
    (lower.includes('sms') || lower.includes('phone') || lower.includes('otp')) &&
    (lower.includes('send') || lower.includes('deliver') || lower.includes('message'))
  ) {
    return 'OTP_DELIVERY_FAILED'
  }
  return 'OTP_DELIVERY_FAILED'
}

function isSupabaseAuthUserMissingError(error: unknown) {
  const lower = safeErrorMessage(error).toLowerCase()
  return (
    lower.includes('user not found') ||
    lower.includes('user_not_found') ||
    lower.includes('no user found') ||
    lower.includes('user does not exist') ||
    lower.includes('signup is disabled') ||
    lower.includes('signups are disabled') ||
    lower.includes('signups not allowed')
  )
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

type OtpProvider = {
  id: string
  userId: string | null
  phone: string
  active: boolean
  verified: boolean
  status: string
}

function supabasePhoneForAuthUser(phone: string) {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

function isAuthUserAlreadyExistsError(error: unknown) {
  const lower = safeErrorMessage(error).toLowerCase()
  return (
    lower.includes('already') ||
    lower.includes('exists') ||
    lower.includes('registered') ||
    lower.includes('duplicate')
  )
}

async function provisionMissingProviderAuthUser(params: {
  provider: OtpProvider
  phone: string
  traceId: string
  countryCode: string
  rawPhone: string
}) {
  try {
    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient.auth.admin.createUser({
      phone: supabasePhoneForAuthUser(params.phone),
      phone_confirm: true,
      user_metadata: {
        role: 'provider',
        providerId: params.provider.id,
      },
    })

    if (error) {
      if (isAuthUserAlreadyExistsError(error)) {
        console.warn('[provider-send-code] missing auth user provision raced with existing user', {
          trace_id: params.traceId,
          providerId: params.provider.id,
          phoneMasked: maskPhone(params.phone),
          countryCode: params.countryCode,
          otpProviderStatus: 'auth_user_already_exists',
          safeErrorMessage: safeLogErrorMessage(error, [params.rawPhone, params.phone]),
          timestamp: timestamp(),
          step: STEP,
        })
        return true
      }

      console.error('[provider-send-code] missing auth user provision failed', {
        trace_id: params.traceId,
        providerId: params.provider.id,
        phoneMasked: maskPhone(params.phone),
        countryCode: params.countryCode,
        otpProviderStatus: 'auth_user_provision_failed',
        safeErrorMessage: safeLogErrorMessage(error, [params.rawPhone, params.phone]),
        timestamp: timestamp(),
        step: STEP,
      })
      return false
    }

    const authUserId = data?.user?.id
    if (authUserId && params.provider.userId !== authUserId) {
      try {
        await db.provider.update({
          where: { id: params.provider.id },
          data: { userId: authUserId },
        })
      } catch (error) {
        console.warn('[provider-send-code] missing auth user provision relink failed', {
          trace_id: params.traceId,
          providerId: params.provider.id,
          phoneMasked: maskPhone(params.phone),
          countryCode: params.countryCode,
          otpProviderStatus: 'auth_user_provision_relink_failed',
          safeErrorMessage: safeLogErrorMessage(error, [params.rawPhone, params.phone]),
          timestamp: timestamp(),
          step: STEP,
        })
      }
    }

    console.info('[provider-send-code] provisioned missing provider auth user', {
      trace_id: params.traceId,
      providerId: params.provider.id,
      phoneMasked: maskPhone(params.phone),
      countryCode: params.countryCode,
      otpProviderStatus: 'auth_user_provisioned',
      timestamp: timestamp(),
      step: STEP,
    })
    return true
  } catch (error) {
    console.error('[provider-send-code] missing auth user provision threw', {
      trace_id: params.traceId,
      providerId: params.provider.id,
      phoneMasked: maskPhone(params.phone),
      countryCode: params.countryCode,
      otpProviderStatus: 'auth_user_provision_exception',
      safeErrorMessage: safeLogErrorMessage(error, [params.rawPhone, params.phone]),
      stack: safeLogErrorStack(error, [params.rawPhone, params.phone]),
      timestamp: timestamp(),
      step: STEP,
    })
    return false
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
  let providerLookupResult: ProviderLookupLogResult = 'not_called'

  try {
    const body = await request.json().catch(() => ({})) as {
      phone?: string
      countryCode?: string
      traceId?: string
      botCheck?: ProviderOtpBotCheck
    }
    traceId = body.traceId || traceId
    rawPhone = body.phone ?? ''
    countryCode = body.countryCode ?? countryCode

    const botCheck = validateProviderOtpBotCheck(body.botCheck)
    if (!botCheck.ok) {
      console.warn('[provider-send-code] bot check failed', {
        trace_id: traceId,
        reason: botCheck.reason,
        phoneMasked: maskPhone(rawPhone),
        countryCode,
        providerLookupResult,
        otpProviderCalled,
        timestamp: timestamp(),
        step: STEP,
      })
      return errorPayload({
        code: 'BOT_CHECK_FAILED',
        traceId,
        phone: rawPhone,
        countryCode,
        status: statusFor('BOT_CHECK_FAILED'),
      })
    }

    const normalized = normalizeOtpPhoneNumber(rawPhone, countryCode)

    if (!normalized.ok) {
      console.warn('[provider-send-code] invalid phone', {
        trace_id: traceId,
        phoneMasked: maskPhone(rawPhone),
        countryCode: normalized.countryCode,
        providerLookupResult,
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

    const forwardedFor = request.headers.get('x-forwarded-for')
    const ip = forwardedFor?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')?.trim()
      || null
    const publicRateCheck = await checkPublicProviderSendCodeLimit({
      phone,
      ip,
      context: { surface: 'provider_send_code_public', traceId },
    })
    if (!publicRateCheck.ok) {
      console.warn('[provider-send-code] public pre-lookup rate limited', {
        trace_id: traceId,
        phoneMasked: maskPhone(phone),
        countryCode,
        rateLimitReason: publicRateCheck.code,
        timestamp: timestamp(),
        step: STEP,
      })
      const code = publicRateCheck.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED'
      return errorPayload({
        code,
        traceId,
        phone,
        countryCode,
        status: statusFor(code),
      })
    }

    const lookupRateCheck = await checkProviderLookupLimit({
      phone,
      ip,
      context: { surface: 'provider_send_code_lookup', traceId },
    })
    if (!lookupRateCheck.ok) {
      console.warn('[provider-send-code] lookup rate limited', {
        trace_id: traceId,
        phoneMasked: maskPhone(phone),
        countryCode,
        rateLimitReason: lookupRateCheck.code,
        timestamp: timestamp(),
        step: STEP,
      })
      const code = lookupRateCheck.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED'
      return errorPayload({
        code,
        traceId,
        phone,
        countryCode,
        status: statusFor(code),
      })
    }

    let provider: { id: string; userId: string | null; phone: string; active: boolean; verified: boolean; status: string } | null
    try {
      const lookupResult = await findProviderForOtpLogin(phone, rawPhone, db)
      if (!lookupResult.found) {
        const hasPendingApp = Boolean(lookupResult.pendingApplicationId)
        providerLookupResult = hasPendingApp ? 'pending_application' : 'not_found'
        console.warn('[provider-send-code] provider not found', {
          trace_id: traceId,
          phoneMasked: maskPhone(phone),
          countryCode,
          providerLookupResult,
          pendingApplicationId: lookupResult.pendingApplicationId ?? null,
          pendingApplicationStatus: lookupResult.pendingApplicationStatus ?? null,
          providerId: null,
          otpProviderCalled,
          timestamp: timestamp(),
          step: STEP,
        })
        provider = null
      } else {
        provider = lookupResult.provider
        providerLookupResult = 'found_active'
      }
    } catch (dbError) {
      providerLookupResult = 'db_error'
      console.error('[provider-send-code] provider lookup failed', {
        trace_id: traceId,
        phoneMasked: maskPhone(phone),
        countryCode,
        providerLookupResult,
        otpProviderCalled,
        safeErrorMessage: safeLogErrorMessage(dbError, [rawPhone, phone]),
        stack: safeLogErrorStack(dbError, [rawPhone, phone]),
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

    if (provider) {
      const access = checkWorkerPortalAccess(provider)

      if (!access.ok) {
        providerLookupResult = access.code === 'WORKER_NOT_APPROVED' ? 'found_not_approved' : 'found_inactive'
        console.warn('[provider-send-code] provider account state deferred until OTP verification', {
          trace_id: traceId,
          phoneMasked: maskPhone(phone),
          countryCode,
          providerLookupResult,
          providerId,
          active: provider.active,
          providerStatus: provider.status,
          otpProviderCalled,
          deferredCode: access.code,
          timestamp: timestamp(),
          step: STEP,
        })
        return otpStartPayload({ traceId, phone })
      }
    } else {
      return otpStartPayload({ traceId, phone })
    }

    const rateCheck = await checkOtpSendLimit({
      phone,
      ip,
      context: { surface: 'provider_send_code', traceId, providerId },
    })
    if (!rateCheck.ok) {
      console.warn('[provider-send-code] rate limited', {
        trace_id: traceId,
        phoneMasked: maskPhone(phone),
        countryCode,
        providerId,
        rateLimitReason: rateCheck.code,
        timestamp: timestamp(),
        step: STEP,
      })
      const code = rateCheck.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED'
      return errorPayload({
        code,
        traceId,
        phone,
        countryCode,
        providerId,
        status: statusFor(code),
      })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    otpSetupStarted = true
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[provider-send-code] Supabase client env missing', {
        trace_id: traceId,
        providerId,
        phoneMasked: maskPhone(phone),
        countryCode,
        providerLookupResult,
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
    const signInWithProviderOtp = () => withOtpTimeout(
      supabase.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: false },
      }),
    )

    const response = await signInWithProviderOtp()

    if (!response || typeof response !== 'object' || !('error' in response)) {
      console.error('[provider-send-code] OTP provider bad response', {
        trace_id: traceId,
        providerId,
        phoneMasked: maskPhone(phone),
        countryCode,
        providerLookupResult,
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
      if (isSupabaseAuthUserMissingError(error)) {
        const provisioned = await provisionMissingProviderAuthUser({
          provider,
          phone,
          traceId,
          countryCode,
          rawPhone,
        })

        if (provisioned) {
          const retryResponse = await signInWithProviderOtp()
          if (!retryResponse || typeof retryResponse !== 'object' || !('error' in retryResponse)) {
            console.error('[provider-send-code] OTP retry after auth user provision returned bad response', {
              trace_id: traceId,
              providerId,
              phoneMasked: maskPhone(phone),
              countryCode,
              providerLookupResult,
              otpProviderCalled,
              otpProviderStatus: 'bad_response',
              safeErrorMessage: 'OTP provider retry did not return an object with an error field.',
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

          const retryError = (retryResponse as { error?: unknown }).error
          if (!retryError) {
            console.info('[provider-send-code] OTP sent after auth user provision', {
              trace_id: traceId,
              providerId,
              phoneMasked: maskPhone(phone),
              countryCode,
              providerLookupResult,
              otpProviderCalled,
              otpProviderStatus: 'sent_after_auth_user_provision',
              timestamp: timestamp(),
              step: STEP,
            })
            return otpStartPayload({ traceId, phone })
          }

          if (!isSupabaseAuthUserMissingError(retryError)) {
            const retryCode = classifyOtpError(retryError)
            console.error('[provider-send-code] OTP retry after auth user provision failed', {
              trace_id: traceId,
              providerId,
              phoneMasked: maskPhone(phone),
              countryCode,
              providerLookupResult,
              otpProviderCalled,
              otpProviderStatus: retryCode,
              code: retryCode,
              safeErrorMessage: safeLogErrorMessage(retryError, [rawPhone, phone]),
              stack: safeLogErrorStack(retryError, [rawPhone, phone]),
              timestamp: timestamp(),
              step: STEP,
            })
            return errorPayload({
              code: retryCode,
              traceId,
              phone,
              countryCode,
              providerId,
              status: statusFor(retryCode),
            })
          }
        }

        console.warn('[provider-send-code] OTP auth user missing; returned uniform start response', {
          trace_id: traceId,
          providerId,
          phoneMasked: maskPhone(phone),
          countryCode,
          providerLookupResult,
          otpProviderCalled,
          otpProviderStatus: 'auth_user_missing',
          safeErrorMessage: safeLogErrorMessage(error, [rawPhone, phone]),
          timestamp: timestamp(),
          step: STEP,
        })
        return otpStartPayload({ traceId, phone })
      }

      const code = classifyOtpError(error)
      console.error('[provider-send-code] OTP send failed', {
        trace_id: traceId,
        providerId,
        phoneMasked: maskPhone(phone),
        countryCode,
        providerLookupResult,
        otpProviderCalled,
        otpProviderStatus: code,
        code,
        safeErrorMessage: safeLogErrorMessage(error, [rawPhone, phone]),
        stack: safeLogErrorStack(error, [rawPhone, phone]),
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
      providerId,
      phoneMasked: maskPhone(phone),
      countryCode,
      providerLookupResult,
      otpProviderCalled,
      otpProviderStatus: 'sent',
      timestamp: timestamp(),
      step: STEP,
    })
    return otpStartPayload({ traceId, phone })
  } catch (error) {
    if (otpProviderCalled && isSupabaseAuthUserMissingError(error)) {
      console.warn('[provider-send-code] OTP auth user missing after provider exception; returned uniform start response', {
        trace_id: traceId,
        providerId,
        phoneMasked: maskPhone(phone || rawPhone),
        countryCode,
        providerLookupResult,
        otpProviderCalled,
        otpProviderStatus: 'auth_user_missing',
        safeErrorMessage: safeLogErrorMessage(error, [rawPhone, phone]),
        timestamp: timestamp(),
        step: STEP,
      })
      return otpStartPayload({ traceId, phone: phone || rawPhone })
    }

    const code = otpProviderCalled
      ? classifyOtpError(error)
      : otpSetupStarted
        ? 'AUTH_CONFIG_MISSING'
        : 'AUTH_RESPONSE_INVALID'
    console.error('[provider-send-code] unexpected error', {
      trace_id: traceId,
      providerId,
      phoneMasked: maskPhone(phone || rawPhone),
      countryCode,
      providerLookupResult: providerLookupResult === 'not_called' ? 'unknown' : providerLookupResult,
      otpProviderCalled,
      otpProviderStatus: otpProviderCalled ? code : 'not_called_or_unknown',
      safeErrorMessage: safeLogErrorMessage(error, [rawPhone, phone]),
      stack: safeLogErrorStack(error, [rawPhone, phone]),
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
