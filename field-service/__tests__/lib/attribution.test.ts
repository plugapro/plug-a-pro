import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureAttributionFromLocation,
  captureUtmFromLocation,
  getStoredAttribution,
  getStoredUtm,
  parseAttributionJson,
} from '@/lib/attribution'

// Minimal localStorage stub. The module only uses get/set; one shared store
// across tests is wiped in beforeEach.
function makeStorage() {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      store = {}
    },
    _seed: (k: string, v: string) => {
      store[k] = v
    },
  }
}

const storage = makeStorage()

function stubLocation(url: string, referrer = '') {
  const u = new URL(url)
  vi.stubGlobal('window', {
    location: { href: url, search: u.search, pathname: u.pathname, hostname: u.hostname },
    localStorage: storage,
  })
  vi.stubGlobal('document', { referrer })
}

beforeEach(() => {
  storage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captureAttributionFromLocation', () => {
  it('captures every UTM key and click ID from the URL', () => {
    stubLocation(
      'https://app.plugapro.co.za/book/electrician?utm_source=google&utm_medium=cpc&utm_campaign=jhb_emergency&utm_term=electrician_near_me&utm_content=hero_cta&gclid=abc123&gbraid=gb1&wbraid=wb1&fbclid=fb1&msclkid=ms1',
    )
    const state = captureAttributionFromLocation()
    expect(state?.first_touch).toMatchObject({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'jhb_emergency',
      utm_term: 'electrician_near_me',
      utm_content: 'hero_cta',
      gclid: 'abc123',
      gbraid: 'gb1',
      wbraid: 'wb1',
      fbclid: 'fb1',
      msclkid: 'ms1',
      landing_path: '/book/electrician',
    })
    expect(state?.first_touch?.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps first-touch immutable while refreshing last-touch on a later visit', () => {
    stubLocation('https://app.plugapro.co.za/?utm_source=google&utm_campaign=campaign_a')
    captureAttributionFromLocation()

    stubLocation('https://app.plugapro.co.za/?utm_source=meta&utm_campaign=campaign_b')
    const state = captureAttributionFromLocation()

    expect(state?.first_touch?.utm_source).toBe('google')
    expect(state?.first_touch?.utm_campaign).toBe('campaign_a')
    expect(state?.last_touch?.utm_source).toBe('meta')
    expect(state?.last_touch?.utm_campaign).toBe('campaign_b')
  })

  it('captures an external referrer but drops a self referrer', () => {
    stubLocation('https://app.plugapro.co.za/?fbclid=fb_xyz', 'https://www.facebook.com/somepage')
    let state = captureAttributionFromLocation()
    expect(state?.first_touch?.fbclid).toBe('fb_xyz')
    expect(state?.first_touch?.referrer).toBe('https://www.facebook.com/somepage')

    // Fresh visitor, internal hop only — referrer should not be stored
    storage.clear()
    stubLocation(
      'https://app.plugapro.co.za/?utm_source=google',
      'https://plugapro.co.za/services/electrician',
    )
    state = captureAttributionFromLocation()
    expect(state?.first_touch?.referrer).toBeUndefined()
  })

  it('does not reset last-touch on an empty intra-site navigation', () => {
    stubLocation('https://app.plugapro.co.za/?utm_source=google')
    captureAttributionFromLocation()

    stubLocation('https://app.plugapro.co.za/some/page')
    const state = captureAttributionFromLocation()

    expect(state?.last_touch?.utm_source).toBe('google')
  })

  it('clamps oversize values to 200 characters', () => {
    const long = 'a'.repeat(300)
    stubLocation(`https://app.plugapro.co.za/?utm_campaign=${long}`)
    const state = captureAttributionFromLocation()
    expect(state?.first_touch?.utm_campaign?.length).toBe(200)
  })

  it('migrates a legacy pap_utm_first_touch entry on first capture', () => {
    storage._seed(
      'pap_utm_first_touch',
      JSON.stringify({ utm_source: 'legacy', utm_medium: 'organic' }),
    )
    stubLocation('https://app.plugapro.co.za/?utm_source=google')
    const state = captureAttributionFromLocation()

    // First-touch stays with the migrated legacy data — credit isn't lost.
    expect(state?.first_touch?.utm_source).toBe('legacy')
    expect(state?.first_touch?.utm_medium).toBe('organic')
    // New capture refreshes last-touch
    expect(state?.last_touch?.utm_source).toBe('google')
  })

  it('returns null when there are no params and no external referrer and nothing stored', () => {
    stubLocation('https://app.plugapro.co.za/')
    expect(captureAttributionFromLocation()).toBeNull()
    expect(getStoredAttribution()).toBeNull()
  })
})

describe('getStoredUtm legacy shim', () => {
  it('returns first-touch UTMs in the legacy 4-key shape and omits click IDs', () => {
    stubLocation(
      'https://app.plugapro.co.za/?utm_source=google&utm_medium=cpc&utm_campaign=test&fbclid=should_not_leak',
    )
    captureAttributionFromLocation()
    const utm = getStoredUtm()
    expect(utm).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'test',
    })
    expect((utm as Record<string, string> | null)?.fbclid).toBeUndefined()
  })

  it('returns null when no first-touch is stored', () => {
    stubLocation('https://app.plugapro.co.za/')
    expect(getStoredUtm()).toBeNull()
  })
})

describe('captureUtmFromLocation legacy entry point', () => {
  it('delegates to captureAttributionFromLocation', () => {
    stubLocation('https://app.plugapro.co.za/?utm_source=google')
    captureUtmFromLocation()
    expect(getStoredUtm()?.utm_source).toBe('google')
  })
})

describe('parseAttributionJson (server-side)', () => {
  it('returns null for empty / non-string input', () => {
    expect(parseAttributionJson(null)).toBeNull()
    expect(parseAttributionJson(undefined)).toBeNull()
    expect(parseAttributionJson('')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseAttributionJson('{not json')).toBeNull()
    expect(parseAttributionJson('"a string"')).toBeNull()
    expect(parseAttributionJson('42')).toBeNull()
  })

  it('parses a full first+last touch payload, preserving every known field', () => {
    const payload = JSON.stringify({
      first_touch: {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'jhb_emergency',
        utm_term: 'electrician_near_me',
        utm_content: 'hero_cta',
        gclid: 'abc123',
        gbraid: 'gb1',
        wbraid: 'wb1',
        fbclid: 'fb1',
        msclkid: 'ms1',
        referrer: 'https://www.google.com/search',
        landing_path: '/services/electrician',
        captured_at: '2026-06-20T08:30:00.000Z',
      },
      last_touch: {
        utm_source: 'meta',
        captured_at: '2026-06-21T10:00:00.000Z',
      },
    })
    const out = parseAttributionJson(payload)
    expect(out?.first_touch).toMatchObject({
      utm_source: 'google',
      utm_campaign: 'jhb_emergency',
      gclid: 'abc123',
      fbclid: 'fb1',
      referrer: 'https://www.google.com/search',
      landing_path: '/services/electrician',
      captured_at: '2026-06-20T08:30:00.000Z',
    })
    expect(out?.last_touch?.utm_source).toBe('meta')
  })

  it('ignores fields with wrong types and unknown extras', () => {
    const out = parseAttributionJson(
      JSON.stringify({
        first_touch: {
          utm_source: 'google',
          utm_medium: 12345, // not a string — should be skipped
          gclid: { nested: 'object' }, // not a string — should be skipped
          this_is_unknown: 'ignored',
          captured_at: '2026-06-20T08:30:00.000Z',
        },
      }),
    )
    expect(out?.first_touch?.utm_source).toBe('google')
    expect(out?.first_touch?.utm_medium).toBeUndefined()
    expect(out?.first_touch?.gclid).toBeUndefined()
    expect((out?.first_touch as Record<string, string> | null)?.this_is_unknown).toBeUndefined()
  })

  it('clamps oversize values', () => {
    const long = 'b'.repeat(500)
    const out = parseAttributionJson(
      JSON.stringify({ first_touch: { utm_campaign: long, captured_at: 'x' } }),
    )
    expect(out?.first_touch?.utm_campaign?.length).toBe(200)
  })

  it('returns null when both touches are empty objects', () => {
    expect(
      parseAttributionJson(JSON.stringify({ first_touch: {}, last_touch: {} })),
    ).toBeNull()
  })

  it('falls back to a fresh captured_at when the payload lacks one', () => {
    const out = parseAttributionJson(
      JSON.stringify({ first_touch: { utm_source: 'google' } }),
    )
    expect(out?.first_touch?.utm_source).toBe('google')
    expect(out?.first_touch?.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  // Security: refuse hostile landing_path / referrer values so they can't
  // reach the admin <Link href> render in customers/[id] + bookings/[id]
  // (XSS / open redirect via attribution data path).
  it('rejects javascript: URIs in landing_path', () => {
    const out = parseAttributionJson(
      JSON.stringify({ first_touch: { landing_path: 'javascript:alert(1)' } }),
    )
    expect(out).toBeNull()
  })

  it('rejects protocol-relative landing_path (//evil.com)', () => {
    const out = parseAttributionJson(
      JSON.stringify({ first_touch: { utm_source: 'google', landing_path: '//evil.com/x' } }),
    )
    // Other fields still parse, but landing_path is stripped.
    expect(out?.first_touch?.utm_source).toBe('google')
    expect(out?.first_touch?.landing_path).toBeUndefined()
  })

  it('rejects data:/file:/vbscript: referrer URLs and only allows http(s)', () => {
    for (const bad of ['data:text/html,evil', 'file:///etc/passwd', 'vbscript:msgbox(1)', 'javascript:1']) {
      const out = parseAttributionJson(
        JSON.stringify({ first_touch: { referrer: bad } }),
      )
      expect(out, `should refuse referrer ${bad}`).toBeNull()
    }
    const ok = parseAttributionJson(
      JSON.stringify({ first_touch: { referrer: 'https://www.google.com/search' } }),
    )
    expect(ok?.first_touch?.referrer).toBe('https://www.google.com/search')
  })
})

// Security regression for the URL capture path (browser usually constrains
// these, but the JSON we POST crosses a trust boundary — keep the in-process
// guard symmetric with the server-side parser).
describe('captureAttributionFromLocation — scheme guards', () => {
  it('does not persist a protocol-relative landing_path', () => {
    // Constructing a URL with a protocol-relative-looking pathname isn't
    // representable through real navigation; assert that the pathname guard
    // would reject the trailing-slash form too.
    stubLocation('https://app.plugapro.co.za//?utm_source=google')
    const state = captureAttributionFromLocation()
    // Pathname '//' is rejected by the !startsWith('//') guard.
    expect(state?.first_touch?.landing_path).toBeUndefined()
  })

  it('drops a non-http(s) referrer', () => {
    stubLocation('https://app.plugapro.co.za/?utm_source=google', 'file:///tmp/x')
    const state = captureAttributionFromLocation()
    expect(state?.first_touch?.referrer).toBeUndefined()
  })
})
