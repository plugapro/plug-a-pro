import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

import { getPublicAppUrl } from '@/lib/provider-credit-copy'

describe('getPublicAppUrl', () => {
  it('returns the base URL when NEXT_PUBLIC_APP_URL is a valid absolute URL', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://plugapro.co.za')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getPublicAppUrl()).toBe('https://plugapro.co.za')
  })

  it('appends path to the base URL', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://plugapro.co.za')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getPublicAppUrl('/quotes/tok-123')).toBe('https://plugapro.co.za/quotes/tok-123')
  })

  it('prefers APP_PUBLIC_URL over NEXT_PUBLIC_APP_URL when both are set', () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://primary.plugapro.co.za')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://fallback.plugapro.co.za')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getPublicAppUrl()).toBe('https://primary.plugapro.co.za')
  })

  it('strips trailing slash from the base URL', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://plugapro.co.za/')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getPublicAppUrl('/path')).toBe('https://plugapro.co.za/path')
  })

  it('returns empty string when NEXT_PUBLIC_APP_URL is localhost in production', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getPublicAppUrl()).toBe('')
  })

  it('returns empty string when URL is not absolute (missing protocol)', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'plugapro.co.za')
    vi.stubEnv('NODE_ENV', 'production')
    expect(getPublicAppUrl()).toBe('')
  })

  it('returns empty string when no env var is set', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(getPublicAppUrl()).toBe('')
  })

  it('allows localhost in development', () => {
    vi.stubEnv('APP_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'development')
    expect(getPublicAppUrl()).toBe('http://localhost:3000')
  })
})
