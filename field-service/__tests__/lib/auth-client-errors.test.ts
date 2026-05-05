import { describe, expect, it } from 'vitest'

import { getOtpVerifyErrorMessage } from '@/lib/auth-client-errors'

describe('getOtpVerifyErrorMessage', () => {
  it('maps expired-code errors to actionable copy', () => {
    expect(getOtpVerifyErrorMessage('OTP expired')).toContain('expired')
  })

  it('maps invalid-code errors to actionable copy', () => {
    expect(getOtpVerifyErrorMessage('Invalid token')).toContain('Invalid code')
  })

  it('falls back to a generic safe message', () => {
    expect(getOtpVerifyErrorMessage('provider returned weird backend failure')).toBe(
      'We could not verify your code right now. Please try again.',
    )
  })
})
