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
import { buildSessionCookieHeader, resolveSessionMaxAge } from '@/lib/auth-session-cookie'

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

    const response = NextResponse.json({ userId: user.id, adminAccess, adminRole })
    response.headers.set('Set-Cookie', buildSessionCookieHeader(accessToken, maxAge))
    return response
  } catch (err) {
    console.error('[api/auth/session] POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE() {
  // Clear the session cookie (sign out)
  const response = NextResponse.json({ ok: true })
  response.headers.set(
    'Set-Cookie',
    'sb-access-token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
  )
  return response
}
