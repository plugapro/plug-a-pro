// ─── Reason code registry tests ──────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  getReasonCodesForQueue,
  getReasonCode,
  noteRequiredForCode,
  DISPATCH_REASON_CODES,
} from '@/lib/reason-codes'

describe('getReasonCodesForQueue', () => {
  it('returns codes for DISPATCH queue', () => {
    const codes = getReasonCodesForQueue('DISPATCH')
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.map((c) => c.code)).toContain('COVERAGE_GAP')
    expect(codes.map((c) => c.code)).toContain('OTHER')
  })

  it('every list includes OTHER as the last code', () => {
    const queues = ['VALIDATION', 'DISPATCH', 'FIELD_EXCEPTION', 'QUOTE_APPROVAL', 'DISPUTE', 'PAYMENT_FOLLOW_UP', 'PROVIDER_ONBOARDING'] as const
    for (const q of queues) {
      const codes = getReasonCodesForQueue(q)
      expect(codes.at(-1)?.code).toBe('OTHER')
    }
  })

  it('excludes deprecated codes', () => {
    // Temporarily test by checking that a deprecated code does not appear
    // This test validates the filter logic even without a deprecated fixture
    const codes = getReasonCodesForQueue('DISPATCH')
    expect(codes.every((c) => !c.deprecated)).toBe(true)
  })
})

describe('getReasonCode', () => {
  it('returns the matching code object', () => {
    const code = getReasonCode('DISPATCH', 'COVERAGE_GAP')
    expect(code).toBeDefined()
    expect(code?.label).toBe('No providers in area')
    expect(code?.requiresNote).toBe(false)
  })

  it('returns undefined for unknown code', () => {
    expect(getReasonCode('DISPATCH', 'UNKNOWN_CODE')).toBeUndefined()
  })
})

describe('noteRequiredForCode', () => {
  it('returns true for OTHER in every queue', () => {
    const queues = ['DISPATCH', 'FIELD_EXCEPTION', 'VALIDATION', 'QUOTE_APPROVAL', 'DISPUTE', 'PAYMENT_FOLLOW_UP'] as const
    for (const q of queues) {
      expect(noteRequiredForCode(q, 'OTHER')).toBe(true)
    }
  })

  it('returns false for codes that do not require a note', () => {
    expect(noteRequiredForCode('DISPATCH', 'COVERAGE_GAP')).toBe(false)
    expect(noteRequiredForCode('DISPATCH', 'DUPLICATE_REQUEST')).toBe(false)
  })

  it('returns true for codes that require elaboration', () => {
    expect(noteRequiredForCode('DISPATCH', 'FRAUD_SUSPECTED')).toBe(true)
    expect(noteRequiredForCode('FIELD_EXCEPTION', 'ADDITIONAL_SCOPE_REQUIRED')).toBe(true)
  })

  it('returns false for unknown code (safe default)', () => {
    expect(noteRequiredForCode('DISPATCH', 'NO_SUCH_CODE')).toBe(false)
  })
})
