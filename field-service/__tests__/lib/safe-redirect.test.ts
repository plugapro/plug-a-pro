import { describe, expect, it } from 'vitest'

import {
  getSafeAdminNextPath,
  getSafeCustomerNextPath,
  getSafeNextPath,
  getSafeProviderNextPath,
} from '@/lib/safe-redirect'

describe('getSafeNextPath', () => {
  it('allows relative in-app paths', () => {
    expect(getSafeNextPath('/bookings/abc?tab=history', '/bookings')).toBe(
      '/bookings/abc?tab=history',
    )
  })

  it('rejects absolute external urls', () => {
    expect(getSafeNextPath('https://evil.example/steal', '/bookings')).toBe('/bookings')
  })

  it('rejects protocol-relative urls', () => {
    expect(getSafeNextPath('//evil.example/steal', '/bookings')).toBe('/bookings')
  })

  it('rejects malformed escape paths', () => {
    expect(getSafeNextPath('/\\evil', '/bookings')).toBe('/bookings')
  })

  it('falls back when path is empty', () => {
    expect(getSafeNextPath('', '/bookings')).toBe('/bookings')
  })

  it('keeps customer sign-in callbacks on customer-owned routes', () => {
    expect(getSafeCustomerNextPath('/bookings/abc?tab=history')).toBe('/bookings/abc?tab=history')
    expect(getSafeCustomerNextPath('/profile')).toBe('/profile')
    expect(getSafeCustomerNextPath('/provider/jobs')).toBe('/bookings')
    expect(getSafeCustomerNextPath('/admin/bookings')).toBe('/bookings')
  })

  it('keeps provider sign-in callbacks on provider-owned routes', () => {
    expect(getSafeProviderNextPath('/provider/jobs')).toBe('/provider/jobs')
    expect(getSafeProviderNextPath('/provider/credits')).toBe('/provider/jobs')
    expect(getSafeProviderNextPath('/bookings')).toBe('/provider/jobs')
    expect(getSafeProviderNextPath('/profile')).toBe('/provider/jobs')
  })

  it('keeps admin sign-in callbacks on admin-owned routes', () => {
    expect(getSafeAdminNextPath('/admin/bookings')).toBe('/admin/bookings')
    expect(getSafeAdminNextPath('/admin/dashboard')).toBe('/admin/dashboard')
    expect(getSafeAdminNextPath('/bookings')).toBe('/admin')
    expect(getSafeAdminNextPath('/provider/jobs')).toBe('/admin')
  })

  it('rejects role-crossing callbacks for provider sign-in', () => {
    expect(getSafeProviderNextPath('/bookings', '/provider/jobs')).toBe('/provider/jobs')
    expect(getSafeProviderNextPath('https://evil.example.com/bookings')).toBe('/provider/jobs')
    expect(getSafeProviderNextPath('/admin/dashboard', '/provider/jobs')).toBe('/provider/jobs')
  })

  it('rejects role-crossing callbacks for customer sign-in', () => {
    expect(getSafeCustomerNextPath('/provider/jobs', '/bookings')).toBe('/bookings')
    expect(getSafeCustomerNextPath('https://evil.example.com/bookings')).toBe('/bookings')
    expect(getSafeCustomerNextPath('/admin/providers', '/bookings')).toBe('/bookings')
  })
})
