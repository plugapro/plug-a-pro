import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  SA_EXAMPLE_MOBILE_E164,
  SA_EXAMPLE_MOBILE_E164_NO_PLUS,
  SA_EXAMPLE_MOBILE_LOCAL,
  SA_OTP_SIGN_IN_HELPER_TEXT,
} from '@/lib/auth-example-phone'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'

describe('normalizeOtpPhoneNumber', () => {
  it.each([
    ['0821234567', '+27821234567'],
    ['82 123 4567', '+27821234567'],
    ['082-123-4567', '+27821234567'],
    ['(082) 123 4567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['27 82 123 4567', '+27821234567'],
    ['+27821234567', '+27821234567'],
    ['+27 82 123 4567', '+27821234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeOtpPhoneNumber(input, 'ZA')).toMatchObject({
      ok: true,
      countryCode: 'ZA',
      dialCode: '+27',
      e164: expected,
      nationalNumber: '821234567',
    })
  })

  it('rejects invalid South African mobile numbers', () => {
    expect(normalizeOtpPhoneNumber('12345', 'ZA')).toMatchObject({
      ok: false,
      errorCode: 'INVALID_PHONE_NUMBER',
    })
  })

  it('rejects unsupported international country codes', () => {
    expect(normalizeOtpPhoneNumber('+447700900123', 'GB')).toMatchObject({
      ok: false,
      errorCode: 'UNSUPPORTED_COUNTRY_CODE',
    })
  })

  it('uses the approved neutral number in shared auth helper copy', () => {
    expect(SA_OTP_SIGN_IN_HELPER_TEXT).toBe(
      'South Africa is selected for OTP sign-in. You can enter 0821234567, 27821234567, or +27821234567.',
    )
    expect(SA_OTP_SIGN_IN_HELPER_TEXT).toContain(SA_EXAMPLE_MOBILE_LOCAL)
    expect(SA_OTP_SIGN_IN_HELPER_TEXT).toContain(SA_EXAMPLE_MOBILE_E164_NO_PLUS)
    expect(SA_OTP_SIGN_IN_HELPER_TEXT).toContain(SA_EXAMPLE_MOBILE_E164)
  })

  it('wires shared helper copy into customer and provider sign-in screens', () => {
    const authPages = [
      'app/(auth)/sign-in/page.tsx',
      'app/(auth)/provider-sign-in/page.tsx',
    ]
    const oldExampleNumbers = [
      `082${'303'}5070`,
      `2782${'303'}5070`,
      `+2782${'303'}5070`,
    ]

    for (const page of authPages) {
      const source = readFileSync(path.join(process.cwd(), page), 'utf8')
      expect(source).toContain('SA_OTP_SIGN_IN_HELPER_TEXT')
      for (const oldExampleNumber of oldExampleNumbers) {
        expect(source).not.toContain(oldExampleNumber)
      }
    }
  })
})
