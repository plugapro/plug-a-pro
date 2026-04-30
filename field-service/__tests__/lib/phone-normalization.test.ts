import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'

describe('normalizeOtpPhoneNumber', () => {
  it.each([
    ['0823035070', '+27823035070'],
    ['82 303 5070', '+27823035070'],
    ['082-303-5070', '+27823035070'],
    ['(082) 303 5070', '+27823035070'],
    ['27823035070', '+27823035070'],
    ['27 82 303 5070', '+27823035070'],
    ['+27823035070', '+27823035070'],
    ['+27 82 303 5070', '+27823035070'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeOtpPhoneNumber(input, 'ZA')).toMatchObject({
      ok: true,
      countryCode: 'ZA',
      dialCode: '+27',
      e164: expected,
      nationalNumber: '823035070',
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

  it('uses safe fake numbers in Worker Portal helper copy', () => {
    const signInSource = readFileSync(
      path.join(process.cwd(), 'app/(auth)/provider-sign-in/page.tsx'),
      'utf8',
    )

    expect(signInSource).toContain('081 234 5678')
    expect(signInSource).toContain('27812345678')
    expect(signInSource).toContain('+27812345678')
    expect(signInSource).not.toContain('0823035070')
    expect(signInSource).not.toContain('27823035070')
    expect(signInSource).not.toContain('+27823035070')
  })
})
