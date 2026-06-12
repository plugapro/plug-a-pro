import { describe, expect, it } from 'vitest'
import {
  ADMIN_DOMAIN,
  isAdminDomainHost,
  isDesktopBrowserUserAgent,
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

describe('isDesktopBrowserUserAgent (mobile-only app gate)', () => {
  const UA = {
    macSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    // iPadOS 13+ Safari is byte-identical to desktop Mac Safari.
    ipadDesktopUA:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    ipadChrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120 Mobile/15E148 Safari/604.1',
    macChrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    macEdge:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
    winChrome:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    linuxX11: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    androidTablet:
      'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  }

  it('does not block tablets, phones, bots, or unknown/empty UAs', () => {
    expect(isDesktopBrowserUserAgent(UA.ipadDesktopUA)).toBe(false) // modern iPad — the bug being fixed
    expect(isDesktopBrowserUserAgent(UA.ipadLegacy)).toBe(false)
    expect(isDesktopBrowserUserAgent(UA.ipadChrome)).toBe(false)
    expect(isDesktopBrowserUserAgent(UA.androidTablet)).toBe(false)
    expect(isDesktopBrowserUserAgent(UA.iphone)).toBe(false)
    expect(isDesktopBrowserUserAgent(UA.googlebot)).toBe(false)
    expect(isDesktopBrowserUserAgent(null)).toBe(false)
    expect(isDesktopBrowserUserAgent('')).toBe(false)
  })

  it('treats ambiguous Mac Safari as not-desktop (client gate decides)', () => {
    // Mac Safari and iPad Safari are indistinguishable by UA, so we fail open.
    expect(isDesktopBrowserUserAgent(UA.macSafari)).toBe(false)
  })

  it('still blocks unambiguous desktop browsers', () => {
    expect(isDesktopBrowserUserAgent(UA.macChrome)).toBe(true)
    expect(isDesktopBrowserUserAgent(UA.macFirefox)).toBe(true)
    expect(isDesktopBrowserUserAgent(UA.macEdge)).toBe(true)
    expect(isDesktopBrowserUserAgent(UA.winChrome)).toBe(true)
    expect(isDesktopBrowserUserAgent(UA.linuxX11)).toBe(true)
  })
})
