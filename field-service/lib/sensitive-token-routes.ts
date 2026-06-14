// Routes whose path segment IS a bearer credential (signed token / magic link).
// Analytics/marketing scripts must never emit the URL of these pages to a third
// party (e.g. the Meta Pixel PageView beacon carries window.location), or the
// token leaks. Keep in sync with the token routes declared in proxy.ts.
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
