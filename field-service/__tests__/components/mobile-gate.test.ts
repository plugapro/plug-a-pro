import { describe, expect, it } from 'vitest'
import { isDesktopAdminBypassPath } from '@/components/shared/mobile-gate'

describe('isDesktopAdminBypassPath', () => {
  it('allows desktop bypass for dedicated admin domain root and clean paths', () => {
    expect(isDesktopAdminBypassPath({ pathname: '/', host: 'admin.plugapro.co.za' })).toBe(true)
    expect(isDesktopAdminBypassPath({ pathname: '/dispatch', host: 'admin.plugapro.co.za' })).toBe(true)
    expect(isDesktopAdminBypassPath({ pathname: '/customers', host: 'admin.plugapro.co.za:443' })).toBe(true)
  })

  it('allows desktop bypass for /admin routes on app domain', () => {
    expect(isDesktopAdminBypassPath({ pathname: '/admin', host: 'app.plugapro.co.za' })).toBe(true)
    expect(isDesktopAdminBypassPath({ pathname: '/admin/providers', host: 'app.plugapro.co.za' })).toBe(true)
  })

  it('blocks desktop bypass for customer/provider paths', () => {
    expect(isDesktopAdminBypassPath({ pathname: '/bookings', host: 'app.plugapro.co.za' })).toBe(false)
    expect(isDesktopAdminBypassPath({ pathname: '/provider', host: 'app.plugapro.co.za' })).toBe(false)
    expect(isDesktopAdminBypassPath({ pathname: '/services', host: 'app.plugapro.co.za' })).toBe(false)
  })
})
