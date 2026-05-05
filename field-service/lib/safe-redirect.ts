export function getSafeNextPath(
  candidate: string | null | undefined,
  fallback: string,
): string {
  if (!candidate) return fallback

  const trimmed = candidate.trim()
  if (!trimmed.startsWith('/')) return fallback
  if (trimmed.startsWith('//')) return fallback
  if (trimmed.includes('\\')) return fallback

  try {
    const url = new URL(trimmed, 'https://plugapro.local')
    if (url.origin !== 'https://plugapro.local') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

// Route-safelist checks use explicit, role-aware prefixes. This prevents:
// - /provider-sign-in links accidentally returning customers to provider-only views
// - /sign-in links returning providers to customer-only pages
// - /admin-sign-in links accepting customer/admin mixed callbacks
const CUSTOMER_ROUTE_PREFIXES = [
  '/account',
  '/approve',
  '/book',
  '/bookings',
  '/confirm-completion',
  '/payments',
  '/providers',
  '/profile',
  '/request',
  '/quotes',
  '/requests',
  '/services',
  '/track',
]

const PROVIDER_ROUTE_PREFIXES = [
  '/provider/jobs',
  '/provider/profile',
]

const ADMIN_ROUTE_PREFIXES = [
  '/admin',
  '/admin/dashboard',
  '/admin/bookings',
  '/admin/jobs',
  '/admin/providers',
  '/admin/customers',
  '/admin/payments',
]

function pathIsInPrefixes(path: string, prefixes: string[]): boolean {
  const pathname = new URL(path, 'https://plugapro.local').pathname
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function getSafeCustomerNextPath(
  candidate: string | null | undefined,
  fallback = '/bookings',
): string {
  const safePath = getSafeNextPath(candidate, fallback)
  return pathIsInPrefixes(safePath, CUSTOMER_ROUTE_PREFIXES) ? safePath : fallback
}

export function getSafeProviderNextPath(
  candidate: string | null | undefined,
  fallback = '/provider/jobs',
): string {
  const safePath = getSafeNextPath(candidate, fallback)
  return pathIsInPrefixes(safePath, PROVIDER_ROUTE_PREFIXES) ? safePath : fallback
}

export function getSafeAdminNextPath(
  candidate: string | null | undefined,
  fallback = '/admin',
): string {
  const safePath = getSafeNextPath(candidate, fallback)
  return pathIsInPrefixes(safePath, ADMIN_ROUTE_PREFIXES) ? safePath : fallback
}
