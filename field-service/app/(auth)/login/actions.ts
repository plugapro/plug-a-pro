'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { getSafeAdminNextPath } from '@/lib/safe-redirect'

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

function normalizeInput(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

async function resolveAbsoluteUrl(path: string): Promise<string> {
  const requestHeaders = await headers()
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'https'
  const host = requestHeaders.get('host')

  const base = host
    ? `${proto}://${host}`
    : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

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

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeInput(formData.get('email'))
  const password = normalizeInput(formData.get('password'))
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

  const sessionUrl = await resolveAbsoluteUrl('/api/auth/session')
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

  if (sessionRes.status === 403) {
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
    return {
      status: 'error',
      email,
      errorCode: 'err/auth/service-unavailable',
    }
  }

  redirect(next)
}
