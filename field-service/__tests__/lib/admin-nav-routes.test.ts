import { describe, it, expect } from 'vitest'
import {
  ADMIN_NAV_ITEMS,
  ADMIN_SMOKE_ROUTES,
  ADMIN_FLAGGED_SMOKE_ROUTES,
} from '../../lib/admin-nav-routes'

describe('ADMIN_NAV_ITEMS', () => {
  it('exposes the Verifications page so operators can reach the identity-verification queue from the sidebar', () => {
    const entry = ADMIN_NAV_ITEMS.find((item) => item.href === '/admin/verifications')
    expect(entry, '/admin/verifications must be present in ADMIN_NAV_ITEMS').toBeDefined()
    expect(entry?.label).toBe('Verifications')
  })

  it('places the Verifications entry immediately after Applications so identity review follows application approval visually', () => {
    const applicationsIdx = ADMIN_NAV_ITEMS.findIndex((item) => item.href === '/admin/applications')
    const verificationsIdx = ADMIN_NAV_ITEMS.findIndex((item) => item.href === '/admin/verifications')
    expect(applicationsIdx, '/admin/applications must precede /admin/verifications').toBeGreaterThanOrEqual(0)
    expect(verificationsIdx).toBe(applicationsIdx + 1)
  })

  it('propagates Verifications into ADMIN_SMOKE_ROUTES so post-deploy smoke catches regressions', () => {
    // ADMIN_SMOKE_ROUTES is derived from ADMIN_NAV_ITEMS - adding to the nav should
    // automatically extend smoke coverage without a second edit site.
    expect(ADMIN_SMOKE_ROUTES).toContain('/admin/verifications')
  })

  it('exposes the provider economics calculator in the admin sidebar and smoke routes', () => {
    const href = '/admin/commercial/provider-economics'
    const entry = ADMIN_NAV_ITEMS.find((item) => item.href === href)

    expect(entry, `${href} must be present in ADMIN_NAV_ITEMS`).toBeDefined()
    expect(entry?.label).toBe('Economics')
    expect(ADMIN_SMOKE_ROUTES).toContain(href)
  })
})

describe('flag-gated launch routes', () => {
  const FLAGGED = [
    { href: '/admin/launch-readiness', flag: 'launch.west_rand_pilot.readiness_report' },
    { href: '/admin/nudges', flag: 'launch.west_rand_pilot.nudge_console' },
  ] as const

  for (const { href, flag } of FLAGGED) {
    it(`${href} is present in ADMIN_NAV_ITEMS carrying its flag`, () => {
      const entry = ADMIN_NAV_ITEMS.find((item) => item.href === href)
      expect(entry, `${href} must be present in ADMIN_NAV_ITEMS`).toBeDefined()
      expect('flag' in entry! && entry!.flag).toBe(flag)
    })

    it(`${href} is excluded from unconditional ADMIN_SMOKE_ROUTES (404s while flag is off)`, () => {
      expect(ADMIN_SMOKE_ROUTES).not.toContain(href)
    })

    it(`${href} is covered by ADMIN_FLAGGED_SMOKE_ROUTES instead`, () => {
      expect(ADMIN_FLAGGED_SMOKE_ROUTES).toContain(href)
    })
  }

  it('every unflagged nav item still flows into ADMIN_SMOKE_ROUTES', () => {
    const unflaggedHrefs = ADMIN_NAV_ITEMS.filter((item) => !('flag' in item)).map((item) => item.href)
    expect(ADMIN_SMOKE_ROUTES).toEqual(unflaggedHrefs)
  })
})
