// proxy.ts — Next.js 16 request interceptor (replaces middleware.ts)
// Handles: role-based route protection, auth redirects
//
// Location: same level as app/ (project root, or inside src/ if using --src-dir)
// Runtime: Node.js (supports full Node.js APIs — no edge-only restrictions)

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'

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
  '/requests/access',      // signed single-ticket links are scoped to one request
  '/leads/access',         // HMAC-signed provider lead links — token validates identity; no session needed
  '/api/cron',             // Vercel cron invokes these without a session cookie; handlers enforce CRON_SECRET
  '/api/internal',         // internal service-to-service calls; handlers enforce CRON_SECRET
  '/api/webhooks',
  '/api/auth/session',     // called client-side after sign-in to persist the HttpOnly session cookie
  '/api/auth/link',        // called client-side after OTP — no session cookie yet
  '/api/health',           // monitoring probe — must be reachable without a session cookie
]

const PUBLIC_SIGNED_JOB_ROUTE = /^\/provider\/jobs\/[^/]+\/(?:handover|arrival|quick-update)$/
const PUBLIC_CUSTOMER_HANDOVER_ROUTE = /^\/customer\/requests\/[^/]+\/provider-handover$/
const PUBLIC_SIGNED_PROVIDER_API_ROUTE = /^\/api\/provider\/leads\/[^/]+\/contact-customer$/

// Routes that require provider role
const PROVIDER_PATHS = ['/provider', '/technician', '/api/provider']

// Routes that require active AdminUser access
const ADMIN_PATHS = ['/admin']

// admin.plugapro.co.za uses clean paths — map them to internal /admin/* routes
// /          → /admin
// /sign-in   → /admin-sign-in
// /dispatch  → /admin/dispatch  (and so on for all sub-pages)
function toAdminInternalPath(pathname: string): string {
  if (pathname === '/') return '/admin'
  if (pathname === '/sign-in') return '/admin-sign-in'
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/admin')
  ) return pathname
  return `/admin${pathname}`
}

export async function proxy(request: NextRequest) {
  const originalPathname = request.nextUrl.pathname
  const host = request.headers.get('host') ?? ''
  const isAdminDomain = host === 'admin.plugapro.co.za'

  // Compute the internal path (rewritten for admin domain, unchanged otherwise)
  const pathname = isAdminDomain ? toAdminInternalPath(originalPathname) : originalPathname

  // Build the final response — rewrite URL when on admin domain, pass-through otherwise
  const buildResponse = (extraHeaders?: Record<string, string>) => {
    let res: NextResponse
    if (isAdminDomain && pathname !== originalPathname) {
      const target = request.nextUrl.clone()
      target.pathname = pathname
      res = NextResponse.rewrite(target)
    } else {
      res = NextResponse.next()
    }
    if (extraHeaders) {
      Object.entries(extraHeaders).forEach(([k, v]) => res.headers.set(k, v))
    }
    return res
  }

  // Allow public paths (checked against the internal path)
  if (isPublicPath(pathname)) {
    return buildResponse()
  }

  // Read auth token from cookie
  const token = request.cookies.get('sb-access-token')?.value

  if (!token) {
    return redirectToSignIn(request, pathname, isAdminDomain)
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

    if (error || !user) return redirectToSignIn(request, pathname, isAdminDomain)

    const legacyRole = user.user_metadata?.role ?? 'customer'
    let effectiveRole = legacyRole

    // Enforce provider-only routes
    if (PROVIDER_PATHS.some((p) => pathname.startsWith(p))) {
      if (legacyRole !== 'provider') {
        return NextResponse.redirect(new URL('/provider-sign-in', request.url))
      }
    }

    // Enforce admin-only routes
    if (ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
      const adminUser = await db.adminUser
        .findFirst({
          where: { OR: [{ userId: user.id }, { email: user.email ?? '' }] },
          select: { role: true, active: true },
        })
        .catch(() => null)

      if (adminUser) {
        // AdminUser row found — honour DB state regardless of legacy metadata
        if (!adminUser.active) {
          // Deactivated accounts are blocked even if Supabase metadata still says admin/owner
          return redirectToSignIn(request, pathname, isAdminDomain)
        }
        effectiveRole = adminUser.role.toLowerCase()
      } else {
        // No AdminUser row — legacy fallback for accounts that predate the AdminUser table.
        // Run scripts/backfill-admin-users.ts to migrate these to DB rows.
        const metaRole = user.user_metadata?.role as string | undefined
        if (metaRole !== 'admin' && metaRole !== 'owner') {
          return redirectToSignIn(request, pathname, isAdminDomain)
        }
        effectiveRole = metaRole
      }
    }

    // Inject user context into headers for downstream use
    return buildResponse({ 'x-user-id': user.id, 'x-user-role': effectiveRole })
  } catch {
    return redirectToSignIn(request, pathname, isAdminDomain)
  }
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_SIGNED_JOB_ROUTE.test(pathname)) return true
  if (PUBLIC_CUSTOMER_HANDOVER_ROUTE.test(pathname)) return true
  if (PUBLIC_SIGNED_PROVIDER_API_ROUTE.test(pathname)) return true

  return PUBLIC_PATHS.some((path) => {
    if (path === '/') return pathname === '/'
    return pathname === path || pathname.startsWith(`${path}/`)
  })
}

function redirectToSignIn(
  request: NextRequest,
  effectivePath: string,
  isAdminDomain = false,
): NextResponse {
  let destination = '/sign-in'
  if (effectivePath.startsWith('/provider') || effectivePath.startsWith('/technician')) destination = '/provider-sign-in'
  if (effectivePath.startsWith('/admin')) {
    // On admin domain keep URLs clean; on regular domain use full path
    destination = isAdminDomain ? '/sign-in' : '/admin-sign-in'
  }

  const { search } = request.nextUrl
  // callbackUrl uses original (clean) pathname so the post-login redirect is correct
  const callbackPath = `${request.nextUrl.pathname}${search}`
  const url = new URL(destination, request.url)
  url.searchParams.set('callbackUrl', callbackPath)
  url.searchParams.set('next', callbackPath)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    // Match all paths except static files and asset requests.
    '/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$|manifest.json|icons/).*)',
  ],
}
