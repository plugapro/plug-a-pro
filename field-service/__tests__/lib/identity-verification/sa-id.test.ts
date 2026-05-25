import { describe, expect, it } from 'vitest'

import {
  getIdentifierLast4,
  validatePassportNumber,
  validateSaId,
} from '../../../lib/identity-verification/sa-id'

describe('SA identity validation', () => {
  it('accepts a valid South African ID number and derives metadata', () => {
    const result = validateSaId('8001015009087')

    expect(result).toMatchObject({
      ok: true,
      normalized: '8001015009087',
      gender: 'male',
      citizenship: 'citizen',
    })
    expect(result.ok && result.dateOfBirth.toISOString().slice(0, 10)).toBe('1980-01-01')
  })

  it('rejects SA ID numbers that are not 13 digits', () => {
    expect(validateSaId('800101500908')).toEqual({ ok: false, reason: 'format' })
  })

  it('rejects impossible SA ID dates of birth', () => {
    expect(validateSaId('8013325009087')).toEqual({ ok: false, reason: 'date_of_birth' })
  })

  it('rejects SA ID numbers with an invalid checksum', () => {
    expect(validateSaId('8001015009086')).toEqual({ ok: false, reason: 'checksum' })
  })

  it('accepts passport-like identifiers that include letters and digits', () => {
    expect(validatePassportNumber('a12345678')).toEqual({ ok: true, normalized: 'A12345678' })
  })

  it('accepts numeric-only passport-like identifiers for foreign nationals', () => {
    expect(validatePassportNumber('123456789')).toEqual({ ok: true, normalized: '123456789' })
  })

  it('rejects passport-like identifiers with spaces', () => {
    expect(validatePassportNumber('A 1234567')).toEqual({ ok: false, reason: 'format' })
  })

  it('extracts the last four characters from a normalized identifier', () => {
    expect(getIdentifierLast4('A12345678')).toBe('5678')
  })
})
