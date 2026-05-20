import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SESSION_MAX_AGE,
  MAX_SESSION_MAX_AGE,
  buildSessionCookieHeader,
  resolveSessionMaxAge,
} from '@/lib/auth-session-cookie'

describe('auth session cookie helpers', () => {
  test('clamps session max age to the supported window', () => {
    expect(resolveSessionMaxAge(60)).toBe(DEFAULT_SESSION_MAX_AGE)
    expect(resolveSessionMaxAge(7200)).toBe(7200)
    expect(resolveSessionMaxAge(MAX_SESSION_MAX_AGE + 1)).toBe(MAX_SESSION_MAX_AGE)
  })

  test('builds the HttpOnly session cookie header used by the API route', () => {
    const header = buildSessionCookieHeader('token-value', 3600)

    expect(header).toContain('sb-access-token=token-value')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=3600')
  })
})
