// proxy.ts — Next.js 16 request interceptor (replaces middleware.ts)
// Handles: role-based route protection, auth redirects
//
// Location: same level as app/ (project root, or inside src/ if using --src-dir)
// Runtime: Node.js (supports full Node.js APIs — no edge-only restrictions)

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Routes that are public (no auth required)
// Auth model:
//   Customers   → phone OTP    → /sign-in → /verify
//   Providers   → phone OTP    → /provider-sign-in → /provider-verify
//                             (legacy: /technician-sign-in → /technician-verify also supported)
//   Admin/Owner → email+pass   → /admin-sign-in
// Email is reserved for admin/owner. LSM users (customers, providers) use phone only.
const PUBLIC_PATHS = [
  '/',
  '/sign-in',              // customer phone OTP entry
  '/verify',               // customer OTP verification + identity link
  '/provider-sign-in',     // provider phone OTP entry
  '/provider-verify',      // provider OTP verification
  '/technician-sign-in',   // legacy — kept for backward compat
  '/technician-verify',    // legacy — kept for backward compat
  '/admin-sign-in',        // admin / owner email+password
  '/approve',              // extra work approval tokens are public (no login required)
  '/api/webhooks',
  '/api/auth/link',        // called client-side after OTP — no session cookie yet
]

// Routes that require provider role
const PROVIDER_PATHS = ['/provider', '/technician']

// Routes that require admin or owner role
const ADMIN_PATHS = ['/admin']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return response
  }

  // Read auth token from cookie
  const token = request.cookies.get('sb-access-token')?.value

  if (!token) {
    return redirectToSignIn(request)
  }

  // Verify token and extract user metadata
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) return redirectToSignIn(request)

    const role = user.user_metadata?.role ?? 'customer'

    // Enforce provider-only routes
    if (PROVIDER_PATHS.some((p) => pathname.startsWith(p))) {
      if (role !== 'provider') {
        return NextResponse.redirect(new URL('/provider-sign-in', request.url))
      }
    }

    // Enforce admin-only routes
    if (ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
      if (role !== 'admin' && role !== 'owner') {
        return NextResponse.redirect(new URL('/admin-sign-in', request.url))
      }
    }

    // Inject user context into headers for downstream use
    response.headers.set('x-user-id', user.id)
    response.headers.set('x-user-role', role)

    return response
  } catch {
    return redirectToSignIn(request)
  }
}

function redirectToSignIn(request: NextRequest): NextResponse {
  // Route unauthenticated requests to the correct sign-in page based on path prefix
  const { pathname } = request.nextUrl
  let destination = '/sign-in' // default: customer
  if (pathname.startsWith('/provider') || pathname.startsWith('/technician')) destination = '/provider-sign-in'
  if (pathname.startsWith('/admin')) destination = '/admin-sign-in'

  const url = new URL(destination, request.url)
  url.searchParams.set('callbackUrl', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    // Match all paths except static files, _next internals, and favicon
    '/((?!_next/static|_next/image|favicon.ico|og.png|manifest.json|icons/).*)',
  ],
}
