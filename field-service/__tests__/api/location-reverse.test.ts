// Regression: the booking "Use my current location" reverse-geocode endpoint
// must serve anonymous callers. It used to require a customer session, so an
// anonymous request was redirected to /sign-in by the proxy; the client then
// parsed that HTML as JSON and surfaced WebKit's opaque
// "The string did not match the expected pattern." A per-IP rate limit replaces
// the auth gate to protect the Nominatim dependency.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockReverseGeocode, mockResolveStructured, mockCheckLimit, mockTrustedIp } = vi.hoisted(() => ({
  mockReverseGeocode: vi.fn(),
  mockResolveStructured: vi.fn(),
  mockCheckLimit: vi.fn(),
  mockTrustedIp: vi.fn(() => '203.0.113.7'),
}))

vi.mock('@/lib/geocoding', () => ({ reverseGeocodeCoordinates: mockReverseGeocode }))
vi.mock('@/lib/location-nodes', () => ({ resolveStructuredAddressByLabels: mockResolveStructured }))
vi.mock('@/lib/rate-limit', () => ({ checkLocationReverseLimit: mockCheckLimit }))
vi.mock('@/lib/request-ip', () => ({ trustedClientIp: mockTrustedIp }))

async function callGet(url: string) {
  const { GET } = await import('@/app/api/customer/location-reverse/route')
  return GET(new NextRequest(url))
}

describe('GET /api/customer/location-reverse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckLimit.mockResolvedValue({ ok: true })
    mockReverseGeocode.mockResolvedValue({
      street: '12 Main Road',
      suburb: 'Northcliff',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2195',
    })
    mockResolveStructured.mockResolvedValue({
      locationNodeId: 'node-1',
      suburb: 'Northcliff',
      region: 'West Rand',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2195',
    })
  })

  afterEach(() => vi.resetModules())

  it('serves an anonymous caller (no session) with street + resolved selection', async () => {
    const res = await callGet('http://localhost/api/customer/location-reverse?lat=-26.16&lng=27.96')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.street).toBe('12 Main Road')
    expect(body.selection?.locationNodeId).toBe('node-1')
  })

  it('returns 429 when the per-IP rate limit is exceeded', async () => {
    mockCheckLimit.mockResolvedValue({ ok: false, retryAfterMs: 1000 })

    const res = await callGet('http://localhost/api/customer/location-reverse?lat=-26.16&lng=27.96')

    expect(res.status).toBe(429)
    expect(mockReverseGeocode).not.toHaveBeenCalled()
  })

  it('rejects out-of-range / non-finite coordinates with 400', async () => {
    expect((await callGet('http://localhost/api/customer/location-reverse?lat=abc&lng=27')).status).toBe(400)
    expect((await callGet('http://localhost/api/customer/location-reverse?lat=200&lng=27')).status).toBe(400)
  })

  it('returns 404 when no address resolves from the coordinates', async () => {
    mockReverseGeocode.mockResolvedValue(null)

    const res = await callGet('http://localhost/api/customer/location-reverse?lat=-26.16&lng=27.96')

    expect(res.status).toBe(404)
  })
})
