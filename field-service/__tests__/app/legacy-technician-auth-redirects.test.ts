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
