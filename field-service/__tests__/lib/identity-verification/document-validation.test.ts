import { describe, expect, it } from 'vitest'

import { validateIdentityDocumentDetails } from '@/lib/identity-verification/document-validation'

describe('identity document details validation', () => {
  it('validates South African ID numbers and derives identity metadata', () => {
    const result = validateIdentityDocumentDetails({
      identityBasis: 'SA_ID',
      identifier: '8001015009087',
    })

    expect(result).toMatchObject({
      ok: true,
      normalizedIdentifier: '8001015009087',
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      citizenship: 'citizen',
    })
  })

  it('requires country, nationality and future expiry for passports', () => {
    expect(validateIdentityDocumentDetails({
      identityBasis: 'PASSPORT',
      identifier: 'A12345678',
    })).toMatchObject({ ok: false, code: 'COUNTRY_REQUIRED' })

    expect(validateIdentityDocumentDetails({
      identityBasis: 'PASSPORT',
      identifier: 'A12345678',
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      documentExpiryDate: '2020-01-01',
    }, new Date('2026-05-25T00:00:00.000Z'))).toMatchObject({ ok: false, code: 'EXPIRY_IN_PAST' })
  })

  it('applies country-specific passport patterns where known', () => {
    expect(validateIdentityDocumentDetails({
      identityBasis: 'PASSPORT',
      identifier: '123456789',
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      documentExpiryDate: '2030-01-01',
    })).toMatchObject({ ok: false, code: 'INVALID_IDENTIFIER' })

    expect(validateIdentityDocumentDetails({
      identityBasis: 'PASSPORT',
      identifier: 'A12345678',
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      documentExpiryDate: '2030-01-01',
    })).toMatchObject({ ok: true, normalizedIdentifier: 'A12345678' })
  })

  it('requires expiry for permits', () => {
    expect(validateIdentityDocumentDetails({
      identityBasis: 'WORK_PERMIT',
      identifier: 'WP-123456',
      issuingCountry: 'Zimbabwe',
      nationality: 'Zimbabwe',
    })).toMatchObject({ ok: false, code: 'EXPIRY_REQUIRED' })
  })

  it('rejects invalid permit characters instead of silently stripping them', () => {
    expect(validateIdentityDocumentDetails({
      identityBasis: 'WORK_PERMIT',
      identifier: 'WP 123456',
      issuingCountry: 'Zimbabwe',
      nationality: 'Zimbabwe',
      documentExpiryDate: '2030-01-01',
    })).toMatchObject({ ok: false, code: 'INVALID_IDENTIFIER' })
  })

  it('rejects impossible calendar expiry dates', () => {
    expect(validateIdentityDocumentDetails({
      identityBasis: 'PASSPORT',
      identifier: 'A12345678',
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      documentExpiryDate: '2030-02-31',
    })).toMatchObject({ ok: false, code: 'EXPIRY_REQUIRED' })
  })
})
