import { describe, expect, it } from 'vitest'
import { trustedClientIp, trustedClientIpFromHeaders } from '@/lib/request-ip'

describe('trusted request IP helpers', () => {
  it('uses the leftmost public x-forwarded-for address', () => {
    const headers = new Headers({
      'x-forwarded-for': '8.8.8.8, 1.1.1.1',
      'x-real-ip': '9.9.9.9',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('8.8.8.8')
  })

  it('skips private, loopback and malformed forwarded addresses', () => {
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.1, malformed, 127.0.0.1, ::1, 1.1.1.1',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('1.1.1.1')
  })

  it('skips IPv4-mapped private and loopback IPv6 forwarded addresses', () => {
    const headers = new Headers({
      'x-forwarded-for': '::ffff:10.0.0.1, ::ffff:127.0.0.1, ::ffff:192.168.1.10, 8.8.4.4',
      'x-real-ip': '::ffff:127.0.0.1',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('8.8.4.4')
  })

  it('skips zero-padded full IPv4-mapped loopback private and reserved addresses', () => {
    const headers = new Headers({
      'x-forwarded-for':
        '0000:0000:0000:0000:0000:ffff:7f00:0001, 0000:0000:0000:0000:0000:ffff:0a00:0001, 0000:0000:0000:0000:0000:ffff:c000:0201, 1.0.0.1',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('1.0.0.1')
  })

  it('normalizes zero-padded full IPv4-mapped global addresses', () => {
    const headers = new Headers({
      'x-forwarded-for': '0000:0000:0000:0000:0000:ffff:0808:0808, 1.1.1.1',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('8.8.8.8')
  })

  it('skips reserved and non-global forwarded addresses', () => {
    const headers = new Headers({
      'x-forwarded-for':
        '192.0.2.1, 198.51.100.23, 203.0.113.20, 100.64.0.1, 198.18.0.1, 224.0.0.1, 240.0.0.1, 2001:db8::1, ff02::1, 2606:4700:4700::1111',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('2606:4700:4700::1111')
  })

  it('falls back to x-real-ip when x-forwarded-for has no public address', () => {
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.1, 192.168.1.10, fd00::1, malformed',
      'x-real-ip': '9.9.9.9',
    })

    expect(trustedClientIpFromHeaders(headers)).toBe('9.9.9.9')
  })

  it('returns null when no trusted proxy header contains a public address', () => {
    const headers = new Headers({
      'x-forwarded-for': '10.0.0.1, 192.168.1.10, malformed',
      'x-real-ip': '127.0.0.1',
    })

    expect(trustedClientIpFromHeaders(headers)).toBeNull()

    const request = new Request('https://app.plugapro.co.za/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ ip: '8.8.8.8' }),
    })

    expect(trustedClientIp(request)).toBeNull()
  })
})
