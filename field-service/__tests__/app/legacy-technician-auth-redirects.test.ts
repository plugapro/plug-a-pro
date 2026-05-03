import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildLegacyAuthRedirectPath } from '@/lib/legacy-auth-redirect'

describe('legacy /technician-* auth pages', () => {
  const signIn = readFileSync(
    join(process.cwd(), 'app/(auth)/technician-sign-in/page.tsx'),
    'utf8',
  )
  const verify = readFileSync(
    join(process.cwd(), 'app/(auth)/technician-verify/page.tsx'),
    'utf8',
  )
  const providerVerify = readFileSync(
    join(process.cwd(), 'app/(auth)/provider-verify/page.tsx'),
    'utf8',
  )

  it('technician-sign-in is a server-side redirect to /provider-sign-in', () => {
    expect(signIn).toContain("from 'next/navigation'")
    expect(signIn).toContain("buildLegacyAuthRedirectPath('/provider-sign-in', params)")
    expect(signIn).not.toContain("'use client'")
    expect(signIn).not.toContain('signInWithOtp')
  })

  it('technician-verify is a server-side redirect to /provider-verify', () => {
    expect(verify).toContain("from 'next/navigation'")
    expect(verify).toContain("buildLegacyAuthRedirectPath('/provider-verify', params)")
    expect(verify).not.toContain("'use client'")
    expect(verify).not.toContain('verifyOtp')
    expect(verify).not.toContain("hasn't been approved yet")
  })

  it('/provider-verify is a live client-side OTP form — not a redirect shell', () => {
    // Must be a real interactive page, not accidentally converted back to a server redirect.
    expect(providerVerify).toContain("'use client'")
    // Must not borrow the redirect helper used by the legacy shim pages.
    expect(providerVerify).not.toContain('buildLegacyAuthRedirectPath')
    // Must not call Supabase client-side auth directly (uses custom /api/auth/provider/* routes).
    expect(providerVerify).not.toContain('signInWithOtp')
    // Must not reference the legacy route being redirected away from.
    expect(providerVerify).not.toContain('/technician-verify')
  })

  it('preserves legacy query parameters when redirecting to canonical provider auth', () => {
    expect(buildLegacyAuthRedirectPath('/provider-sign-in', {
      callbackUrl: '/technician?tab=jobs',
      next: '/provider/credits',
      phone: '+27823035070',
      ignored: undefined,
    })).toBe('/provider-sign-in?callbackUrl=%2Ftechnician%3Ftab%3Djobs&next=%2Fprovider%2Fcredits&phone=%2B27823035070')

    expect(buildLegacyAuthRedirectPath('/provider-verify', {
      phone: '+27823035070',
      tag: ['cached', 'bookmark'],
    })).toBe('/provider-verify?phone=%2B27823035070&tag=cached&tag=bookmark')
  })
})
