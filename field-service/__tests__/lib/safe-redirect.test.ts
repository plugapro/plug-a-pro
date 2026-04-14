import { describe, expect, it } from 'vitest'

import { getSafeNextPath } from '@/lib/safe-redirect'

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
})
