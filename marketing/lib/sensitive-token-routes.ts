// Mirror of field-service/lib/sensitive-token-routes.ts. Routes whose path
// segment IS a bearer credential (signed token / magic link) must never have
// their URL emitted to a third party (e.g. the Meta Pixel PageView beacon
// carries window.location) or captured into attribution storage, or the token
// leaks. The marketing site is content-only and has no token routes today, but
// the guard is mirrored so AttributionCapture is safe-by-default the moment one
// is ever added (and the two apps don't diverge). Keep in sync with the
// field-service list.
export const TOKEN_ROUTE_PREFIXES = [
  '/requests/access',
  '/requests/handover',
  '/quotes',
  '/approve',
  '/confirm-completion',
  '/leads/access',
  '/provider/verify',
  '/provider/lead',
  '/provider/job',
  '/provider/handoff',
  '/client/request',
  '/client/handoff',
  '/review',
  '/ticket',
  '/r',
  '/provider-public-profile',
] as const

export function isSensitiveTokenRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return TOKEN_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
