// Regression (finding 910005fb): the Meta Pixel must be suppressed on routes
// whose path segment is a bearer token, so PageView beacons never ship the token
// to Facebook. This guards the denylist those decisions rely on.

import { describe, expect, it } from 'vitest'
import { isSensitiveTokenRoute, TOKEN_ROUTE_PREFIXES } from '@/lib/sensitive-token-routes'

describe('isSensitiveTokenRoute', () => {
  it('flags every tokenized magic-link route (prefix + token segment)', () => {
    const tokenized = [
      '/requests/access/abc123',
      '/requests/handover/tok',
      '/quotes/qtok',
      '/approve/atok',
      '/confirm-completion/ctok',
      '/leads/access/ltok',
      '/provider/verify/vtok',
      '/provider/lead/ptok',
      '/provider/job/jtok',
      '/provider/handoff/htok',
      '/client/request/crtok',
      '/client/handoff/chtok',
      '/review/rtok',
      '/ticket/ttok',
      '/r/short',
      '/provider-public-profile/pptok',
    ]
    for (const path of tokenized) {
      expect(isSensitiveTokenRoute(path)).toBe(true)
    }
  })

  it('does not flag normal marketing/app routes', () => {
    for (const path of ['/', '/providers', '/book/plumbing', '/sign-in', '/profile', '/provider', '/bookings']) {
      expect(isSensitiveTokenRoute(path)).toBe(false)
    }
  })

  it('handles null/undefined safely', () => {
    expect(isSensitiveTokenRoute(null)).toBe(false)
    expect(isSensitiveTokenRoute(undefined)).toBe(false)
  })

  it('does not flag a route that merely shares a prefix substring', () => {
    // '/r' must match '/r/<token>' but not '/requests' or '/reviews-archive'
    expect(isSensitiveTokenRoute('/requests')).toBe(false)
    expect(isSensitiveTokenRoute('/reviews-archive')).toBe(false)
    expect(TOKEN_ROUTE_PREFIXES).toContain('/r')
  })
})
