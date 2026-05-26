// proxy.ts — Next.js 16 request interceptor (replaces middleware.ts)
// Handles: role-based route protection, auth redirects
//
// Location: same level as app/ (project root, or inside src/ if using --src-dir)
// Runtime: Node.js (supports full Node.js APIs — no edge-only restrictions)

import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import {
  getSafeAdminNextPath,
  getSafeCustomerNextPath,
  getSafeProviderNextPath,
} from '@/lib/safe-redirect'
import { checkWorkerPortalAccess, logWorkerPortalDecision } from '@/lib/worker-provider-auth'

// Routes that are public (no auth required)
// Auth model:
//   Customers   → phone OTP    → /sign-in → /verify
//   Providers   → phone OTP    → /provider-sign-in → /provider-verify
//                             (legacy /technician-sign-in and /technician-verify
//                              now server-redirect to the canonical routes above)
//   Admin/Owner → shared credentials (distributed separately)
// Email is reserved for admin/owner. LSM users (customers, providers) use phone only.
const PUBLIC_PATHS = [
  '/',
  '/sign-in',              // customer phone OTP entry
  '/admin-sign-in',        // admin shared-credential login
  '/login',                // customer auth alias → server-redirects to /sign-in
  '/verify',               // customer OTP verification + identity link
  '/sign-up',              // customer sign-up route
  '/signup',               // customer sign-up alias → server-redirects to /sign-up
  '/provider-sign-in',     // provider phone OTP entry
  '/provider-verify',      // provider OTP verification
  '/provider/terms',       // provider credit rules are linked before login/application
  '/provider/verification', // WhatsApp identity step-up CTA must load before provider login
  '/provider/verify',      // token-gated identity verification PWA links are public
  '/track',                // public customer tracking landing pages
  '/for-providers',        // public provider acquisition page
  '/credit-terms',         // public provider credit terms page
  '/provider-public-profile', // signed Review Providers First profile links are read-only and public
  '/security/checkpoint', // OTP step-up checkpoint reached with pap-step-up-token, before full session
  '/technician-sign-in',   // legacy — server-redirects to /provider-sign-in
  '/technician-verify',    // legacy — server-redirects to /provider-verify
  '/providers',
  '/providers/',
  '/approve',              // extra work approval tokens are public (no login required)
  '/book',                 // booking steps 1-3 are public; submit endpoint enforces auth
  '/requests/access',      // signed single-ticket links are scoped to one request
  '/leads/access',         // HMAC-signed provider lead links — token validates identity; no session needed
  '/api/cron',             // Vercel cron invokes these without a session cookie; handlers enforce CRON_SECRET
  '/api/internal',         // internal service-to-service calls; handlers enforce CRON_SECRET
  '/api/webhooks',
  '/api/payat/webhook',    // Pay@ provider-credit webhook callback from Pay@ infrastructure
  '/api/payat-go/callback',// Pay@Go RTP callback from Pay@ infrastructure
  '/api/review-first/provider-profile/shortlist', // signed profile-token shortlist action
  '/api/provider/identity/upload', // token-gated identity upload endpoint; handler validates token
  '/api/attachments',      // protected image proxy; handler enforces signed ticket/lead token or session ownership
  '/api/auth/session',              // called client-side after sign-in to persist the HttpOnly session cookie
  '/api/auth/link',                 // called client-side after OTP — no session cookie yet
  '/api/auth/hooks',                // Supabase Auth webhook hooks (send-sms, etc.) — signature-verified, no session cookie
  '/api/auth/provider/send-code',   // unauthenticated — provider submits phone to request OTP
  '/api/auth/provider/verify-code', // unauthenticated — verifies OTP, then creates the provider session
  '/api/track',                     // public tracking API; handler validates tracking identifiers
  '/api/locations/search',          // public location search used before booking/auth
  '/api/debug',                     // key-protected diagnostic endpoints — handlers enforce their own key check
  '/api/health',                    // monitoring probe — must be reachable without a session cookie
  '/status',                        // public service status dashboard
  '/r',                             // short WhatsApp handoff alias — server redirects via token resolver
  '/ticket',                        // public token-gated invoice — server-rendered, no session cookie
  '/client/handoff',                // WhatsApp handoff deep-link — token validates identity
  '/confirm-completion',            // HMAC-token job sign-off — no session needed; page verifies token
  '/review',                        // HMAC-token provider review — no session needed; page verifies token
  '/quotes',                        // token-gated quote approval — no session needed; page verifies approvalToken
  '/requests',                      // WhatsApp match-found links land here; page redirects unauthenticated visitors
                                    // to /requests/access/{token} (if a valid token exists) or to /sign-in.
                                    // Must remain public so the page-level token-redirect logic can execute.
]

const PUBLIC_SIGNED_JOB_ROUTE = /^\/provider\/jobs\/[^/]+\/(?:handover|arrival|quick-update|execute|complete)$/
const PUBLIC_SIGNED_PROVIDER_TOKEN_ROUTE = /^\/provider\/(?:handoff|job|lead)\/[^/]+$/
const PUBLIC_CUSTOMER_HANDOVER_ROUTE = /^\/customer\/requests\/[^/]+\/provider-handover$/
const PUBLIC_SIGNED_PROVIDER_API_ROUTE = /^\/api\/provider\/leads\/[^/]+\/contact-customer$/
const PUBLIC_UNSIGNED_LEGACY_LEAD_ROUTE = /^\/leads\/[^/]+$/

// Routes that require provider role
const PROVIDER_PATHS = ['/provider', '/technician', '/api/provider']

// Routes that require active AdminUser access
const ADMIN_PATHS = ['/admin']

// admin.plugapro.co.za uses clean paths — map them to internal /admin/* routes
// /          → /admin
// /dispatch  → /admin/dispatch  (and so on for all sub-pages)
function toAdminInternalPath(pathname: string): string {
  if (pathname === '/') return '/admin'
  // Leave auth pages and asset paths unchanged — they are root-level pages, not admin sub-pages
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/security/checkpoint') ||
    pathname.startsWith('/provider-')
  ) return pathname
  return `/admin${pathname}`
}

export async function proxy(request: NextRequest) {
  const originalPathname = request.nextUrl.pathname
  const host = getPrimaryHostHeader(request)
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

  // Legacy /technician/* → /provider/* redirect (app group removed)
  if (pathname.startsWith('/technician')) {
    const target = request.nextUrl.clone()
    target.pathname = pathname.replace(/^\/technician/, '/provider')
    return NextResponse.redirect(target, { status: 308 })
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

    const metadataRole = user.user_metadata?.role ?? 'customer'
    let effectiveRole = metadataRole
    const rawPhone = user.phone as string | undefined
    const phone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : null

    // Enforce provider-only routes
    if (PROVIDER_PATHS.some((p) => pathname.startsWith(p))) {
      const provider = await db.provider
        .findFirst({
          where: {
            OR: [
              { userId: user.id },
              ...(phone ? [{ phone, userId: null }] : []),
            ],
          },
          select: {
            id: true,
            userId: true,
            phone: true,
            active: true,
            verified: true,
            status: true,
          },
        })
        .catch(() => null)
      const access = checkWorkerPortalAccess(provider)
      logWorkerPortalDecision({
        event: 'middleware',
        traceId: request.headers.get('x-trace-id') ?? 'middleware',
        normalizedPhone: phone,
        authUserId: user.id,
        provider,
        roleCheckResult:
          metadataRole === 'provider' ? 'metadata_provider' : 'resolved_from_provider_record',
        code: access.ok ? 'OK' : access.code,
      })

      if (!access.ok) {
        // Route authenticated users lacking provider access to the provider sign-in
        // screen and include a role-mismatch hint so we can show recovery copy.
        // The callback target is also sanitized so provider auth cannot be
        // driven into customer/admin routes through crafted query params.
        const callbackPath = getSafeProviderNextPath(
          request.nextUrl.pathname,
          '/provider/jobs',
        )
        const providerSignIn = new URL('/provider-sign-in', request.url)
        providerSignIn.searchParams.set('callbackUrl', callbackPath)
        providerSignIn.searchParams.set('next', callbackPath)
        providerSignIn.searchParams.set('error', 'unauthorized')
        return NextResponse.redirect(providerSignIn)
      }
      effectiveRole = 'provider'
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
        // AdminUser row found — honour DB state regardless of metadata.
        if (!adminUser.active) {
          // Deactivated accounts are blocked even if Supabase metadata still says admin/owner
          return redirectToSignIn(request, pathname, isAdminDomain)
        }
        effectiveRole = adminUser.role.toLowerCase()
      } else {
        console.warn('[proxy] admin access blocked: no AdminUser row', { userId: user.id })
        return redirectToSignIn(request, pathname, isAdminDomain)
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
  if (PUBLIC_SIGNED_PROVIDER_TOKEN_ROUTE.test(pathname)) return true
  if (PUBLIC_CUSTOMER_HANDOVER_ROUTE.test(pathname)) return true
  if (PUBLIC_SIGNED_PROVIDER_API_ROUTE.test(pathname)) return true
  if (PUBLIC_UNSIGNED_LEGACY_LEAD_ROUTE.test(pathname)) return true

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
  // Preserve route ownership on redirects:
  // customer routes always return to /sign-in,
  // provider routes always return to /provider-sign-in,
  // admin routes always return to /admin-sign-in.
  if (effectivePath.startsWith('/provider') || effectivePath.startsWith('/technician')) destination = '/provider-sign-in'
  if (effectivePath.startsWith('/admin')) destination = '/admin-sign-in'

  const callbackCandidate = request.nextUrl.pathname + request.nextUrl.search
  const adminDomainCallbackCandidate = effectivePath + request.nextUrl.search
  // Sanitize candidate paths to avoid open-redirects and role-mixed callbacks.
  let callbackPath = callbackCandidate
  if (destination === '/provider-sign-in') {
    callbackPath = getSafeProviderNextPath(callbackCandidate, '/provider/jobs')
  } else if (destination === '/admin-sign-in' && effectivePath.startsWith('/admin')) {
    callbackPath = getSafeAdminNextPath(
      isAdminDomain ? adminDomainCallbackCandidate : callbackCandidate,
      '/admin',
    )
  } else if (destination === '/sign-in') {
    callbackPath = getSafeCustomerNextPath(callbackCandidate, '/bookings')
  }

  const url = new URL(destination, request.url)
  url.searchParams.set('callbackUrl', callbackPath)
  url.searchParams.set('next', callbackPath)
  return NextResponse.redirect(url)
}

function getPrimaryHostHeader(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-host')
  const direct = request.headers.get('host')
  const fallback = request.nextUrl.hostname ?? ''
  const raw = (forwarded ?? direct ?? fallback)
    .split(',')[0]
    .trim()
    .toLowerCase()

  if (!raw) return ''
  if (raw.startsWith('[')) {
    const closing = raw.indexOf(']')
    return closing > 0 ? raw.slice(0, closing + 1) : raw
  }
  return raw.replace(/:\d+$/, '')
}

export const config = {
  matcher: [
    // Match all paths except static files and asset requests.
    '/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$|manifest.json|icons/).*)',
  ],
}
