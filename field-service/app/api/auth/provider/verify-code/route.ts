import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { createServiceClient } from '@/lib/auth'
import { resolveSessionMaxAge, SESSION_COOKIE_NAME } from '@/lib/auth-session-cookie'
import { issueAuthSessionWithSecurityGate } from '@/lib/auth-session-gate'
import { createTraceId, safeErrorMessage, timestamp } from '@/lib/support-diagnostics'
import {
  classifyWorkerOtpVerifyError,
  logWorkerPortalDecision,
  resolveCurrentWorkerFromVerifiedOtpSession,
  statusForWorkerVerifyCode,
  workerVerifyMessageForCode,
} from '@/lib/worker-provider-auth'
import { checkOtpVerifyLimit } from '@/lib/rate-limit'
import { recordAuditLog } from '@/lib/audit'

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

function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
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

    const rateCheck = await checkOtpVerifyLimit({
      phone,
      context: { surface: 'provider_verify_code', traceId },
    })
    if (!rateCheck.ok) {
      logWorkerPortalDecision({
        event: 'verify',
        traceId,
        normalizedPhone: phone,
        authUserId: null,
        roleCheckResult: 'rate_limited',
        code: rateCheck.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED',
      })
      await recordAuditLog({
        actorId: 'system',
        actorRole: 'auth_hook',
        action: 'auth.otp_verify_failed',
        entityType: 'phone',
        entityId: phone,
        after: {
          code: rateCheck.code === 'limiter_unavailable' ? 'OTP_PROVIDER_UNAVAILABLE' : 'RATE_LIMITED',
          traceId,
        } as any,
      }).catch(() => undefined)
      return rateCheck.code === 'limiter_unavailable'
        ? jsonError({ code: 'OTP_PROVIDER_UNAVAILABLE', traceId, status: 503 })
        : jsonError({ code: 'RATE_LIMITED', traceId, status: 429 })
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
      await recordAuditLog({
        actorId: data.user?.id ?? 'system',
        actorRole: 'auth_hook',
        action: 'auth.otp_verify_failed',
        entityType: 'phone',
        entityId: phone,
        after: { code, traceId } as any,
      }).catch(() => undefined)
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
      await recordAuditLog({
        actorId: data.user.id,
        actorRole: 'auth_hook',
        action: 'auth.otp_verify_failed',
        entityType: 'phone',
        entityId: resolved.normalizedPhone ?? phone,
        after: {
          code: resolved.code,
          providerId: resolved.provider?.id ?? null,
          applicationId: resolved.application?.id ?? null,
          traceId,
        } as any,
      }).catch(() => undefined)
      return jsonError({
        code: resolved.code,
        traceId,
        providerId: resolved.provider?.id,
        applicationId: resolved.application?.id,
      })
    }

    await recordAuditLog({
      actorId: data.user.id,
      actorRole: 'auth_hook',
      action: 'auth.otp_verify_success',
      entityType: 'phone',
      entityId: resolved.normalizedPhone ?? phone,
      after: {
        providerId: resolved.provider.id,
        linkedProviderNow: resolved.linkedProviderNow,
        traceId,
      } as any,
    }).catch(() => undefined)

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

    const maxAge = resolveSessionMaxAge(data.session.expires_in)
    const gated = await issueAuthSessionWithSecurityGate({
      accessToken,
      phoneE164: resolved.normalizedPhone,
      userId: data.user.id,
      maxAge,
      sourceRoute: '/api/auth/provider/verify-code',
    })

    if (!gated.ok && gated.reason === 'LOCKED') {
      const response = jsonError({ code: 'ACCOUNT_LOCKED', traceId, status: 423 })
      response.headers.set('Set-Cookie', clearSessionCookieHeader())
      return response
    }

    if (!gated.ok && gated.reason === 'STEP_UP_REQUIRED') {
      const response = NextResponse.json({
        ok: true,
        code: 'STEP_UP_REQUIRED',
        traceId,
        redirectTo: '/security/checkpoint',
      })
      response.headers.set('Set-Cookie', clearSessionCookieHeader())
      response.headers.append('Set-Cookie', gated.pendingStepUpCookie)
      return response
    }

    const response = NextResponse.json({
      ok: true,
      code: 'OK',
      traceId,
      providerId: resolved.provider.id,
      linkedProviderNow: resolved.linkedProviderNow,
    })
    response.headers.set('Set-Cookie', gated.setCookie)
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
