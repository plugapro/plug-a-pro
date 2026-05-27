import { describe, it, expect } from 'vitest'
import { redactSmilePayload } from '../../../../../lib/identity-verification/vendors/smile-id/redact'

const FIXTURE: Record<string, unknown> = {
  SmileJobID: 'smile-job-123',
  PartnerParams: {
    user_id: 'usr-1',
    job_id: 'pap-uuid-here',
    job_type: 11,
    verification_id: 'ver-1',
  },
  ResultCode: '0810',
  ResultText: 'Document Verified',
  Actions: {
    Liveness_Check: 'Passed',
    Selfie_To_ID_Card_Compare: 'Completed',
    Document_Check: 'Passed',
    Verify_Document: 'Passed',
  },
  IsFinalResult: 'true',
  signature: 'A_REAL_HMAC_VALUE',
  timestamp: '2026-05-27T10:00:00.000Z',
  source_sdk: 'rest_api',
  source_sdk_version: '3.1.0',
  Photo: 'BASE64_PHOTO_DATA_LONG_STRING',
  ImageLinks: {
    id_card_back:  'https://smile-cdn/abc/back.jpg?sig=token',
    id_card_image: 'https://smile-cdn/abc/front.jpg?sig=token',
    selfie_image:  'https://smile-cdn/abc/selfie.jpg?sig=token',
  },
  KYCReceipt:        'https://smile-cdn/abc/receipt.pdf?sig=token',
  FullName:          'JANE DOE',
  IDNumber:          '8001015009087',
  SecondaryIDNumber: 'REF-12345',
  DOB:               '1980-01-01',
  Gender:            'F',
  Address:           '123 Test Street, Sandton',
  IssuanceDate:      '2010-05-12',
  ExpirationDate:    '2030-05-11',
  Personal_Info:     { FullName: 'JANE DOE', IDNumber: '8001015009087' },
}

describe('redactSmilePayload', () => {
  it('strips Photo, ImageLinks, KYCReceipt to [REDACTED]', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.Photo).toBe('[REDACTED]')
    expect(r.ImageLinks).toBe('[REDACTED]')
    expect(r.KYCReceipt).toBe('[REDACTED]')
  })

  it('strips FullName/IDNumber/DOB/Gender/Address/IssuanceDate/ExpirationDate/SecondaryIDNumber', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.FullName).toBe('[REDACTED]')
    expect(r.IDNumber).toBe('[REDACTED]')
    expect(r.SecondaryIDNumber).toBe('[REDACTED]')
    expect(r.DOB).toBe('[REDACTED]')
    expect(r.Gender).toBe('[REDACTED]')
    expect(r.Address).toBe('[REDACTED]')
    expect(r.IssuanceDate).toBe('[REDACTED]')
    expect(r.ExpirationDate).toBe('[REDACTED]')
  })

  it('strips nested Personal_Info values', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.Personal_Info).toBe('[REDACTED]')
  })

  it('drops the raw signature entirely (not even as [REDACTED])', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(Object.keys(r)).not.toContain('signature')
  })

  it('preserves SmileJobID, PartnerParams, ResultCode, Actions, timestamp', () => {
    const r = redactSmilePayload(FIXTURE)
    expect(r.SmileJobID).toBe('smile-job-123')
    expect(r.PartnerParams).toEqual(FIXTURE.PartnerParams)
    expect(r.ResultCode).toBe('0810')
    expect(r.Actions).toEqual(FIXTURE.Actions)
    expect(r.timestamp).toBe('2026-05-27T10:00:00.000Z')
  })

  it('contains no PII string literals after serialisation', () => {
    const r = redactSmilePayload(FIXTURE)
    const serialised = JSON.stringify(r)
    expect(serialised).not.toContain('JANE DOE')
    expect(serialised).not.toContain('8001015009087')
    expect(serialised).not.toContain('REF-12345')
    expect(serialised).not.toContain('1980-01-01')
    expect(serialised).not.toContain('123 Test Street')
    expect(serialised).not.toContain('BASE64_PHOTO_DATA_LONG_STRING')
    expect(serialised).not.toContain('A_REAL_HMAC_VALUE')
  })

  it('redacts keys matching the generic denylist regex', () => {
    const r = redactSmilePayload({ phone_number: '+27123456', email: 'a@b.co', some_id_number: 'X' })
    expect(r.phone_number).toBe('[REDACTED]')
    expect(r.email).toBe('[REDACTED]')
    expect(r.some_id_number).toBe('[REDACTED]')
  })

  it('returns a non-object payload as an empty redacted record', () => {
    expect(redactSmilePayload(null)).toEqual({})
    expect(redactSmilePayload('string')).toEqual({})
    expect(redactSmilePayload(42)).toEqual({})
  })
})
