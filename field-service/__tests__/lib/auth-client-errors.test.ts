import { describe, expect, it } from 'vitest'
import { getCustomerOtpSendErrorMessage, getOtpVerifyErrorMessage } from '@/lib/auth-client-errors'

describe('getCustomerOtpSendErrorMessage', () => {
  it('maps WhatsApp config and delivery failures', () => {
    expect(getCustomerOtpSendErrorMessage('otp_whatsapp_disabled')).toContain('could not deliver')
    expect(getCustomerOtpSendErrorMessage('template_not_approved')).toContain('could not deliver')
    expect(getCustomerOtpSendErrorMessage('wa_transient')).toContain('could not deliver')
  })

  it('maps rate limiting messages', () => {
    expect(getCustomerOtpSendErrorMessage('Too many requests').toLowerCase()).toContain('too many')
  })

  it('maps auth-configuration / signup-disabled errors', () => {
    expect(getCustomerOtpSendErrorMessage('signup is disabled')).toContain('not configured')
    expect(getCustomerOtpSendErrorMessage('invalid api key')).toContain('not configured')
    expect(getCustomerOtpSendErrorMessage('signups are disabled')).toContain('not configured')
  })

  it('maps malformed numbers to invalid-number guidance', () => {
    expect(getCustomerOtpSendErrorMessage('Invalid phone number format')).toContain('valid South African mobile')
  })

  it('maps network errors to a user-retriable hint', () => {
    expect(getCustomerOtpSendErrorMessage('Failed to fetch')).toContain('Network issue while sending')
  })

  it('falls back to the generic retry copy', () => {
    expect(getCustomerOtpSendErrorMessage('Some unknown auth failure')).toContain('Could not send code')
  })
})

describe('getOtpVerifyErrorMessage', () => {
  it('maps expired verification errors', () => {
    expect(getOtpVerifyErrorMessage('OTP has expired')).toContain('expired')
  })

  it('maps generic invalid OTP errors', () => {
    expect(getOtpVerifyErrorMessage('invalid token')).toContain('Invalid code')
  })

  it('maps network failures', () => {
    expect(getOtpVerifyErrorMessage('Fetch failed')).toContain('Network issue while verifying')
  })

  it('falls back to generic verify retry copy', () => {
    expect(getOtpVerifyErrorMessage('unexpected internal')).toContain('could not verify')
  })
})
