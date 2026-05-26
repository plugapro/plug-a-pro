// POST /api/auth/session
// Called after a successful Supabase OTP/password verification on the client.
// Verifies the access token server-side, then persists it as an HttpOnly cookie
// so it cannot be read by JavaScript (XSS protection).
//
// Body: { accessToken: string, expiresIn?: number }
// Returns: { userId: string }
//
// DELETE /api/auth/session
// Signs out: clears the session cookie.
// Returns: { ok: true }

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { resolveSessionMaxAge, SESSION_COOKIE_NAME } from '@/lib/auth-session-cookie'
import { issueAuthSessionWithSecurityGate } from '@/lib/auth-session-gate'
import { normalizePhone } from '@/lib/utils'

function phoneE164FromSupabase(rawPhone: unknown): string | null {
  if (typeof rawPhone !== 'string' || !rawPhone.trim()) return null
  const normalized = normalizePhone(rawPhone)
  return normalized.startsWith('+') ? normalized : null
}

function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`
}

export async function GET() {
  try {
    const session = await getSession()
    const response = NextResponse.json({
      authenticated: Boolean(session),
      role: session?.role ?? null,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    const response = NextResponse.json({
      authenticated: false,
      role: null,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accessToken, expiresIn, requireAdmin } = body as {
      accessToken: unknown
      expiresIn: unknown
      requireAdmin?: boolean
    }

    if (!accessToken || typeof accessToken !== 'string') {
      return NextResponse.json({ error: 'accessToken required' }, { status: 400 })
    }

    // Verify the token with Supabase before trusting it
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(accessToken)

    if (error || !user) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    let adminAccess = false
    let adminRole: string | null = null

    if (user.email) {
      const existingAdmin = await db.adminUser.findFirst({
        where: {
          OR: [{ userId: user.id }, { email: user.email }],
        },
        select: {
          id: true,
          userId: true,
          email: true,
          role: true,
          active: true,
          acceptedAt: true,
        },
      })

      if (existingAdmin) {
        if (existingAdmin.userId !== user.id) {
          await db.adminUser.update({
            where: { id: existingAdmin.id },
            data: {
              userId: user.id,
              acceptedAt: existingAdmin.acceptedAt ?? new Date(),
            },
          })
        } else if (!existingAdmin.acceptedAt) {
          await db.adminUser.update({
            where: { id: existingAdmin.id },
            data: { acceptedAt: new Date() },
          })
        }

        adminAccess = existingAdmin.active
        adminRole = existingAdmin.active ? existingAdmin.role.toLowerCase() : null
      }
    }

    // Refuse to issue a session cookie when the caller requires admin access but the
    // user is not an active admin. This prevents a race window where a non-admin
    // briefly holds a valid HttpOnly session cookie.
    if (requireAdmin && !adminAccess) {
      return NextResponse.json({ error: 'Admin access required', adminAccess: false }, { status: 403 })
    }

    const maxAge = resolveSessionMaxAge(expiresIn)
    const phoneE164 = phoneE164FromSupabase(user.phone)

    if (!phoneE164) {
      return NextResponse.json({ error: 'Phone required for OTP session' }, { status: 400 })
    }

    const gated = await issueAuthSessionWithSecurityGate({
      accessToken,
      phoneE164,
      userId: user.id,
      maxAge,
      sourceRoute: '/api/auth/session',
    })

    if (!gated.ok && gated.reason === 'LOCKED') {
      const response = NextResponse.json(
        { locked: true, code: gated.metadata?.code ?? 'ACCOUNT_LOCKED' },
        { status: 423 },
      )
      response.headers.set('Set-Cookie', clearSessionCookieHeader())
      return response
    }

    if (!gated.ok && gated.reason === 'STEP_UP_REQUIRED') {
      const response = NextResponse.json(
        { stepUpRequired: true, redirectTo: '/security/checkpoint' },
        { status: 200 },
      )
      response.headers.set('Set-Cookie', clearSessionCookieHeader())
      response.headers.append('Set-Cookie', gated.pendingStepUpCookie)
      return response
    }

    const response = NextResponse.json({ userId: user.id, adminAccess, adminRole })
    response.headers.set('Set-Cookie', gated.setCookie)
    return response
  } catch (err) {
    console.error('[api/auth/session] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE() {
  // Clear the session cookie (sign out)
  const response = NextResponse.json({ ok: true })
  response.headers.set('Set-Cookie', clearSessionCookieHeader())
  return response
}
