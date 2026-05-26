import { describe, expect, it } from 'vitest'
import { trustedClientIp, trustedClientIpFromHeaders } from '@/lib/request-ip'

describe('trusted request IP helpers', () => {
  it('uses the leftmost public x-forwarded-for address', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.23, 203.0.113.9',
      'x-real-ip': '203.0.113.10',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('198.51.100.23')
  })

  it('skips private, loopback, and malformed forwarded addresses', () => {
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.1, malformed, 127.0.0.1, ::1, 203.0.113.20',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('203.0.113.20')
  })

  it('falls back to x-real-ip when x-forwarded-for has no public address', () => {
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.1, 192.168.1.10, fd00::1, malformed',
      'x-real-ip': '198.51.100.50',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('198.51.100.50')
  })

  it('returns null when no trusted proxy header contains a public address', () => {
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.1, 192.168.1.10, malformed',
      'x-real-ip': '127.0.0.1',
    })

    expect(trustedClientIpFromHeaders(headers)).toBeNull()

    const request = new Request('https://app.plugapro.co.za/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ ip: '198.51.100.88' }),
    })

    expect(trustedClientIp(request)).toBeNull()
  })
})
