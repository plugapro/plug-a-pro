// A provider must never be routed into customer context. resolveProviderRedirect
// is the single source of truth for sending a provider away from customer
// surfaces (/ and /profile) - distinguishing portal-eligible providers (provider
// area) from pending/in-verification providers (verification status page, which
// is reachable without portal access). Customers are never redirected.

import { describe, expect, it } from 'vitest'
import { resolveProviderRedirect } from '../../lib/provider-routing'

describe('resolveProviderRedirect', () => {
  it('routes a portal-eligible provider to the provider dashboard from home', () => {
    expect(resolveProviderRedirect({ role: 'provider', isProvider: true }, 'home')).toBe('/provider')
  })

  it('routes a portal-eligible provider to the provider profile from profile', () => {
    expect(resolveProviderRedirect({ role: 'provider', isProvider: true }, 'profile')).toBe('/provider/profile')
  })

  it('routes a pending (not-yet-eligible) provider to the verification status page', () => {
    expect(resolveProviderRedirect({ role: 'customer', isProvider: true }, 'home')).toBe('/provider/verification')
    expect(resolveProviderRedirect({ role: 'customer', isProvider: true }, 'profile')).toBe('/provider/verification')
  })

  it('does not redirect a customer-only user', () => {
    expect(resolveProviderRedirect({ role: 'customer', isProvider: false }, 'home')).toBeNull()
    expect(resolveProviderRedirect({ role: 'customer' }, 'profile')).toBeNull()
  })
})
