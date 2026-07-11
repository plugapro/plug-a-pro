import { describe, it, expect } from 'vitest'
import { consentBannerBottomClass, hasTallBottomActionBar } from '@/lib/consent-banner-layout'

describe('consent banner bottom offset', () => {
  it('flags provider registration routes as having a tall bottom action bar', () => {
    expect(hasTallBottomActionBar('/provider/register')).toBe(true)
    expect(hasTallBottomActionBar('/provider/register/phone')).toBe(true)
    expect(hasTallBottomActionBar('/provider/register/review')).toBe(true)
    expect(hasTallBottomActionBar('/for-customers')).toBe(false)
    expect(hasTallBottomActionBar('/')).toBe(false)
    expect(hasTallBottomActionBar(null)).toBe(false)
  })

  it('lifts the banner above the taller action bar on registration routes', () => {
    // Registration routes must clear the ~129px action bar, not the 76px nav.
    expect(consentBannerBottomClass('/provider/register')).toContain('148px')
    expect(consentBannerBottomClass('/provider/register/phone')).toContain('148px')
  })

  it('keeps the default 76px offset everywhere else', () => {
    expect(consentBannerBottomClass('/for-customers')).toContain('76px')
    expect(consentBannerBottomClass('/')).toContain('76px')
    expect(consentBannerBottomClass(null)).toContain('76px')
  })

  it('always returns a safe-area-aware bottom-[] class', () => {
    for (const p of ['/provider/register', '/for-customers', null]) {
      expect(consentBannerBottomClass(p)).toMatch(/^bottom-\[calc\(.*env\(safe-area-inset-bottom/)
    }
  })
})
