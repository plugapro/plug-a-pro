import { describe, expect, it } from 'vitest'

import {
  IDENTITY_BASES,
  getRequiredDocumentKinds,
} from '../../../lib/identity-verification/types'

describe('identity verification document requirements', () => {
  it('requires at least one identity document and a selfie for every identity basis', () => {
    for (const basis of IDENTITY_BASES) {
      const requiredKinds = getRequiredDocumentKinds(basis)

      expect(requiredKinds.length).toBeGreaterThanOrEqual(2)
      expect(requiredKinds).toContain('SELFIE')
    }
  })

  it('uses SA ID evidence for South African ID basis', () => {
    expect(getRequiredDocumentKinds('SA_ID')).toEqual(['ID_FRONT', 'SELFIE'])
  })

  it('uses passport evidence for foreign-national passport basis', () => {
    expect(getRequiredDocumentKinds('PASSPORT')).toEqual(['PASSPORT_PHOTO_PAGE', 'SELFIE'])
  })

  it('uses explicit Section 22 evidence for asylum seekers', () => {
    expect(getRequiredDocumentKinds('ASYLUM_PERMIT')).toEqual([
      'ASYLUM_SEEKER_PERMIT_SECTION_22',
      'SELFIE',
    ])
  })

  it('uses explicit Section 24 evidence for refugees', () => {
    expect(getRequiredDocumentKinds('REFUGEE_PERMIT')).toEqual([
      'REFUGEE_PERMIT_SECTION_24',
      'SELFIE',
    ])
  })
})
