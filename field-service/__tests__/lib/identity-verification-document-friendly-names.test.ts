import { describe, expect, it } from 'vitest'

import { documentFriendlyName } from '@/lib/identity-verification/document-friendly-names'

describe('documentFriendlyName', () => {
  it.each([
    ['SA_ID', 'SA ID'],
    ['PASSPORT', 'passport photo page'],
    ['REFUGEE_ID', 'refugee ID'],
    ['ASYLUM_PERMIT', 'asylum permit'],
    ['REFUGEE_PERMIT', 'refugee permit'],
    ['WORK_PERMIT', 'work permit'],
    ['PERMANENT_RESIDENCE_PERMIT', 'permanent residence permit'],
  ])('%s -> %s', (basis, expected) => {
    expect(documentFriendlyName(basis as never)).toBe(expected)
  })
})
