import type { AuthUser } from './auth'

export type ProviderRedirectContext = 'home' | 'profile'

// Single source of truth for routing an authenticated provider away from customer
// surfaces (/ and /profile). Returns null for non-providers (render customer UI).
//
// Two provider cases, deliberately different destinations:
//  - Portal-eligible (role === 'provider'): active, approved provider → the
//    provider area (dashboard, or provider profile from the profile context).
//  - Not yet eligible but a Provider record exists (isProvider, e.g. pending or
//    mid-identity-verification): role is still 'customer', so the provider area
//    (guarded by requireProvider/checkWorkerPortalAccess) would bounce them to
//    sign-in. Send them to the verification status page instead, which renders
//    without portal access.
//
// This keeps role semantics intact (role gating elsewhere is unaffected) while
// ensuring a provider is never shown customer context.
export function resolveProviderRedirect(
  session: Pick<AuthUser, 'role' | 'isProvider'>,
  context: ProviderRedirectContext,
): string | null {
  if (session.role === 'provider') {
    return context === 'profile' ? '/provider/profile' : '/provider'
  }
  if (session.isProvider) {
    return '/provider/verification'
  }
  return null
}
