import { describe, expect, it } from 'vitest'
import {
  ADMIN_DOMAIN,
  isAdminDomainHost,
  isLikelyMobileUserAgent,
  normalizeHost,
  shouldRestrictAdminDomainToDesktop,
} from '@/lib/admin-desktop-policy'

describe('admin desktop policy', () => {
  it('normalizes host headers by removing port and list suffixes', () => {
    expect(normalizeHost('admin.plugapro.co.za:3000')).toBe(ADMIN_DOMAIN)
    expect(normalizeHost('Admin.PlugAPro.Co.Za')).toBe('admin.plugapro.co.za')
    expect(normalizeHost('localhost, admin.plugapro.co.za')).toBe('localhost')
    expect(normalizeHost('')).toBe('')
  })

  it('matches only the admin host', () => {
    expect(isAdminDomainHost('admin.plugapro.co.za')).toBe(true)
    expect(isAdminDomainHost('admin.plugapro.co.za:4000')).toBe(true)
    expect(isAdminDomainHost('app.plugapro.co.za')).toBe(false)
    expect(isAdminDomainHost(undefined)).toBe(false)
  })

  it('detects common mobile and tablet user agents', () => {
    expect(isLikelyMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1.15')).toBe(true)
    expect(isLikelyMobileUserAgent('Mozilla/5.0 (iPad; CPU OS 17_4) AppleWebKit/605.1.15')).toBe(true)
    expect(isLikelyMobileUserAgent('Dalvik/2.1.0 (Linux; U; Android 13; Pixel 4 XL Build/TQ3A.230605.011)')).toBe(true)
    expect(isLikelyMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(false)
    expect(isLikelyMobileUserAgent(null)).toBe(false)
  })

  it('requires admin host and mobile user agent together to restrict rendering', () => {
    expect(
      shouldRestrictAdminDomainToDesktop(
        'admin.plugapro.co.za',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1.15',
      ),
    ).toBe(true)
    expect(
      shouldRestrictAdminDomainToDesktop(
        'app.plugapro.co.za',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1.15',
      ),
    ).toBe(false)
    expect(
      shouldRestrictAdminDomainToDesktop('admin.plugapro.co.za', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),
    ).toBe(false)
  })
})
