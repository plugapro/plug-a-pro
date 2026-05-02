import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { createServiceClient } from '@/lib/auth'
import { createTraceId, safeErrorMessage, timestamp } from '@/lib/support-diagnostics'
import {
  classifyWorkerOtpVerifyError,
  logWorkerPortalDecision,
  resolveCurrentWorkerFromVerifiedOtpSession,
  statusForWorkerVerifyCode,
  workerVerifyMessageForCode,
} from '@/lib/worker-provider-auth'

const DEFAULT_SESSION_MAX_AGE = 60 * 60
const MAX_SESSION_MAX_AGE = 60 * 60 * 24

function buildCookieHeader(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `sb-access-token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

function jsonError(params: {
  code: ReturnType<typeof classifyWorkerOtpVerifyError> | string
  traceId: string
  status?: number
  providerId?: string
  applicationId?: string
}) {
  return NextResponse.json(
    {
      ok: false,
      code: params.code,
      message: workerVerifyMessageForCode(params.code as any),
      traceId: params.traceId,
      error: {
        code: params.code,
        reason: workerVerifyMessageForCode(params.code as any),
        traceId: params.traceId,
        providerId: params.providerId,
        applicationId: params.applicationId,
        step: 'Worker portal verify-code',
        time: timestamp(),
      },
    },
    { status: params.status ?? statusForWorkerVerifyCode(params.code as any) },
  )
}

export async function POST(request: NextRequest) {
  let traceId = request.headers.get('x-trace-id') || createTraceId('auth')
  let accessToken: string | undefined

  try {
    const body = await request.json().catch(() => ({})) as {
      phone?: string
      code?: string
      token?: string
      traceId?: string
      countryCode?: string
    }
    traceId = body.traceId || traceId

    const phone = body.phone ?? ''
    const token = (body.code ?? body.token ?? '').trim()
    if (!phone || !token) {
      return jsonError({ code: 'INVALID_OTP', traceId, status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    })

    if (error || !data.user || !data.session?.access_token) {
      const code = classifyWorkerOtpVerifyError(error ?? 'OTP verification did not return a session.')
      logWorkerPortalDecision({
        event: 'verify',
        traceId,
        normalizedPhone: phone,
        authUserId: data.user?.id ?? null,
        roleCheckResult: 'otp_failed',
        code,
      })
      return jsonError({ code, traceId })
    }

    accessToken = data.session.access_token

    const resolved = await resolveCurrentWorkerFromVerifiedOtpSession({
      client: db,
      user: data.user,
      submittedPhone: phone,
      countryCode: body.countryCode,
      traceId,
    })

    logWorkerPortalDecision({
      event: 'verify',
      traceId,
      normalizedPhone: resolved.normalizedPhone,
      authUserId: data.user.id,
      provider: resolved.provider,
      application: resolved.application,
      roleCheckResult: data.user.user_metadata?.role === 'provider' ? 'metadata_provider' : 'resolved_from_provider_record',
      code: resolved.ok ? 'OK' : resolved.code,
    })

    if (!resolved.ok) {
      return jsonError({
        code: resolved.code,
        traceId,
        providerId: resolved.provider?.id,
        applicationId: resolved.application?.id,
      })
    }

    try {
      const serviceClient = createServiceClient()
      await serviceClient.auth.admin.updateUserById(data.user.id, {
        user_metadata: {
          ...data.user.user_metadata,
          role: 'provider',
          name: resolved.provider.name ?? data.user.user_metadata?.name,
          providerId: resolved.provider.id,
        },
      })
    } catch (metadataError) {
      console.warn('[provider-verify-code] auth metadata update skipped', {
        trace_id: traceId,
        authUserId: data.user.id,
        providerId: resolved.provider.id,
        safeErrorMessage: safeErrorMessage(metadataError),
        timestamp: timestamp(),
      })
    }

    const requestedMaxAge =
      typeof data.session.expires_in === 'number' && Number.isFinite(data.session.expires_in)
        ? data.session.expires_in
        : DEFAULT_SESSION_MAX_AGE
    const maxAge = Math.min(
      MAX_SESSION_MAX_AGE,
      Math.max(DEFAULT_SESSION_MAX_AGE, Math.floor(requestedMaxAge)),
    )

    const response = NextResponse.json({
      ok: true,
      code: 'OK',
      traceId,
      providerId: resolved.provider.id,
      linkedProviderNow: resolved.linkedProviderNow,
    })
    response.headers.set('Set-Cookie', buildCookieHeader(accessToken, maxAge))
    return response
  } catch (error) {
    console.error('[provider-verify-code] unexpected error', {
      trace_id: traceId,
      accessTokenPresent: Boolean(accessToken),
      safeErrorMessage: safeErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: timestamp(),
    })
    return jsonError({ code: 'UNKNOWN_WORKER_VERIFY_ERROR', traceId, status: 500 })
  }
}
