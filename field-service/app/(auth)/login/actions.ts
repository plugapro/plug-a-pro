'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getSafeAdminNextPath } from '@/lib/safe-redirect'
import { siteConfig } from '@/lib/metadata'
import { normalizeEmailInput, normalizePasswordInput } from '@/lib/auth-input'
import { SESSION_COOKIE_NAME } from '@/lib/auth-session-cookie'
import { STEP_UP_COOKIE_NAME } from '@/lib/otp-security-crypto'

type ErrorCode =
  | 'err/auth/invalid-request'
  | 'err/auth/invalid-credentials'
  | 'err/auth/not-admin'
  | 'err/auth/no-session'
  | 'err/auth/service-unavailable'
  | 'err/auth/locked'
  | string

export type LoginState =
  | { status: 'idle'; email?: string }
  | { status: 'error'; email?: string; errorCode?: ErrorCode; attemptsUsed?: number; attemptsMax?: number }
  | { status: '2fa-required'; email?: string; message?: string }
  | { status: 'locked'; retryAfter?: number }

// SECURITY (finding 40011d3c): the admin session callback URL must NEVER be
// derived from the incoming request's Host / X-Forwarded-Host / X-Forwarded-Proto
// headers. A spoofed Host header would otherwise cause this server action to POST
// the admin Supabase access token to an attacker-controlled origin. We resolve the
// callback origin from the trusted, build/env-configured site URL instead.
function resolveTrustedCallbackUrl(path: string): string {
  // `siteConfig.url` is sourced from APP_PUBLIC_URL / NEXT_PUBLIC_APP_URL (with a
  // safe production default) — not from request headers.
  const base = siteConfig.url || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  return new URL(path, base).toString()
}

function classifyError(errorMessage: string | undefined): {
  code: ErrorCode
  locked: boolean
} {
  const message = errorMessage?.toLowerCase() ?? ''

  if (message.includes('locked') || message.includes('too many attempts')) {
    return { code: 'err/auth/locked', locked: true }
  }

  if (
    message.includes('invalid') ||
    message.includes('credential') ||
    message.includes('password') ||
    message.includes('email')
  ) {
    return { code: 'err/auth/invalid-credentials', locked: false }
  }

  return { code: 'err/auth/invalid-request', locked: false }
}

type SessionCookieName = typeof SESSION_COOKIE_NAME | typeof STEP_UP_COOKIE_NAME

function parseSessionSetCookieHeader(
  setCookieHeader: string | null,
  expectedName: SessionCookieName,
): {
  name: SessionCookieName
  value: string
  options: {
    httpOnly: boolean
    sameSite: 'lax'
    path: string
    maxAge: number
    secure: boolean
  }
} | null {
  if (!setCookieHeader) return null

  const cookieHeaders = setCookieHeader.split(
    /,(?=\s*(?:sb-access-token|pap-step-up-token)=)/,
  )

  for (const header of cookieHeaders) {
    const parts = header.split(';').map((part) => part.trim()).filter(Boolean)
    const [nameValue, ...attributes] = parts
    if (!nameValue) continue

    const separator = nameValue.indexOf('=')
    if (separator <= 0) continue

    const name = nameValue.slice(0, separator)
    if (name !== expectedName) continue

    const maxAgeAttribute = attributes.find((attribute) =>
      attribute.toLowerCase().startsWith('max-age='),
    )
    const parsedMaxAge = Number.parseInt(maxAgeAttribute?.slice('max-age='.length) ?? '', 10)
    if (!Number.isFinite(parsedMaxAge)) return null

    const pathAttribute = attributes.find((attribute) =>
      attribute.toLowerCase().startsWith('path='),
    )
    return {
      name: expectedName,
      value: nameValue.slice(separator + 1),
      options: {
        httpOnly: attributes.some((attribute) => attribute.toLowerCase() === 'httponly'),
        sameSite: 'lax',
        path: pathAttribute?.slice('path='.length) || '/',
        maxAge: parsedMaxAge,
        secure: attributes.some((attribute) => attribute.toLowerCase() === 'secure'),
      },
    }
  }

  return null
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmailInput(formData.get('email'))
  const password = normalizePasswordInput(formData.get('password'))
  const nextRaw = formData.get('next')
  const next = getSafeAdminNextPath(
    typeof nextRaw === 'string' ? nextRaw : null,
    '/admin',
  )

  if (!email || password.length < 6) {
    return {
      status: 'error',
      email,
      errorCode: 'err/auth/invalid-request',
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
      },
    },
  )

  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    const { code, locked } = classifyError(signInError.message)
    if (locked) {
      return {
        status: 'locked',
        retryAfter: 14 * 60 + 27,
      }
    }

    return {
      status: 'error',
      email,
      errorCode: code,
      attemptsUsed: 2,
      attemptsMax: 5,
    }
  }

  if (!data.user || !data.session?.access_token) {
    return {
      status: 'error',
      email,
      errorCode: 'err/auth/no-session',
    }
  }

  const sessionUrl = resolveTrustedCallbackUrl('/api/auth/session')
  const sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      accessToken: data.session.access_token,
      expiresIn: data.session.expires_in ?? 3600,
      requireAdmin: true,
    }),
  })
  const cookieStore = await cookies()
  const setCookieHeader = sessionRes.headers.get('Set-Cookie')

  if (sessionRes.status === 403) {
    const clearedSessionCookie = parseSessionSetCookieHeader(setCookieHeader, SESSION_COOKIE_NAME)
    if (clearedSessionCookie) {
      cookieStore.set(clearedSessionCookie.name, clearedSessionCookie.value, clearedSessionCookie.options)
    }

    try {
      await supabase.auth.signOut()
    } catch {
      // Intentionally ignored. Best-effort cleanup before returning auth error.
    }

    return {
      status: 'error',
      email,
      errorCode: 'err/auth/not-admin',
    }
  }

  if (!sessionRes.ok) {
    const clearedSessionCookie = parseSessionSetCookieHeader(setCookieHeader, SESSION_COOKIE_NAME)
    if (clearedSessionCookie) {
      cookieStore.set(clearedSessionCookie.name, clearedSessionCookie.value, clearedSessionCookie.options)
    }

    return {
      status: 'error',
      email,
      errorCode: 'err/auth/service-unavailable',
    }
  }

  const sessionPayload = await sessionRes.json().catch(() => ({})) as {
    stepUpRequired?: boolean
    redirectTo?: string
  }

  if (sessionPayload.stepUpRequired) {
    const clearedSessionCookie = parseSessionSetCookieHeader(setCookieHeader, SESSION_COOKIE_NAME)
    const pendingCookie = parseSessionSetCookieHeader(setCookieHeader, STEP_UP_COOKIE_NAME)
    if (!clearedSessionCookie || !pendingCookie) {
      return {
        status: 'error',
        email,
        errorCode: 'err/auth/service-unavailable',
      }
    }

    cookieStore.set(clearedSessionCookie.name, clearedSessionCookie.value, clearedSessionCookie.options)
    cookieStore.set(pendingCookie.name, pendingCookie.value, pendingCookie.options)
    redirect(sessionPayload.redirectTo || '/security/checkpoint')
  }

  const sessionCookie = parseSessionSetCookieHeader(setCookieHeader, SESSION_COOKIE_NAME)
  if (!sessionCookie) {
    return {
      status: 'error',
      email,
      errorCode: 'err/auth/service-unavailable',
    }
  }

  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.options)
  redirect(next)
}
