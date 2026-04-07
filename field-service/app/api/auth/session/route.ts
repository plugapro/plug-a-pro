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

function buildCookieHeader(token: string, maxAge: number): string {
  const isProd = process.env.NODE_ENV === 'production'
  const secure = isProd ? '; Secure' : ''
  return `sb-access-token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { accessToken, expiresIn } = body as {
      accessToken: unknown
      expiresIn: unknown
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

    const maxAge = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600

    const response = NextResponse.json({ userId: user.id })
    response.headers.set('Set-Cookie', buildCookieHeader(accessToken, maxAge))
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
