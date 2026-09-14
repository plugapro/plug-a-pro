import { describe, expect, it } from 'vitest'
import {
  kycStatusForVerificationStatus,
  resolveKycStatusUpdate,
} from '../../../lib/identity-verification/kyc-status'
import type { VerificationStatus } from '../../../lib/identity-verification/types'

describe('kycStatusForVerificationStatus', () => {
  it('maps every verification entry state to IN_PROGRESS', () => {
    const inProgress: VerificationStatus[] = [
      'STARTED',
      'CONSENTED',
      'AWAITING_IDENTIFIER',
      'AWAITING_DOCUMENT',
      'AWAITING_SELFIE',
    ]
    for (const status of inProgress) {
      expect(kycStatusForVerificationStatus(status)).toBe('IN_PROGRESS')
    }
  })

  it('maps submit / processing / awaiting-liveness / manual review to SUBMITTED', () => {
    const submitted: VerificationStatus[] = [
      'SUBMITTED',
      'PROCESSING',
      'AWAITING_LIVENESS',
      'NEEDS_MANUAL_REVIEW',
    ]
    for (const status of submitted) {
      expect(kycStatusForVerificationStatus(status)).toBe('SUBMITTED')
    }
  })

  it('maps PASSED with PASS decision to VERIFIED', () => {
    expect(kycStatusForVerificationStatus('PASSED', 'PASS')).toBe('VERIFIED')
  })

  it('treats PASSED without a PASS decision as still pending (SUBMITTED)', () => {
    expect(kycStatusForVerificationStatus('PASSED')).toBe('SUBMITTED')
    expect(kycStatusForVerificationStatus('PASSED', 'MANUAL_REVIEW')).toBe('SUBMITTED')
  })

  it('maps FAILED to REJECTED and EXPIRED to EXPIRED', () => {
    expect(kycStatusForVerificationStatus('FAILED')).toBe('REJECTED')
    expect(kycStatusForVerificationStatus('EXPIRED')).toBe('EXPIRED')
  })

  it('maps RETRY_REQUIRED to REJECTED so the provider sees "Identity retry needed"', () => {
    expect(kycStatusForVerificationStatus('RETRY_REQUIRED')).toBe('REJECTED')
  })

  it('returns NOT_STARTED for NOT_STARTED and null for CANCELLED', () => {
    expect(kycStatusForVerificationStatus('NOT_STARTED')).toBe('NOT_STARTED')
    expect(kycStatusForVerificationStatus('CANCELLED')).toBeNull()
  })
})

describe('resolveKycStatusUpdate', () => {
  it('returns null when current and target match', () => {
    expect(resolveKycStatusUpdate('IN_PROGRESS', 'IN_PROGRESS')).toBeNull()
    expect(resolveKycStatusUpdate('VERIFIED', 'VERIFIED')).toBeNull()
  })

  it('returns null when target is null', () => {
    expect(resolveKycStatusUpdate('NOT_STARTED', null)).toBeNull()
  })

  it('allows forward progress through the normal flow', () => {
    expect(resolveKycStatusUpdate('NOT_STARTED', 'IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(resolveKycStatusUpdate('IN_PROGRESS', 'SUBMITTED')).toBe('SUBMITTED')
    expect(resolveKycStatusUpdate('SUBMITTED', 'VERIFIED')).toBe('VERIFIED')
    expect(resolveKycStatusUpdate('SUBMITTED', 'REJECTED')).toBe('REJECTED')
    expect(resolveKycStatusUpdate('SUBMITTED', 'EXPIRED')).toBe('EXPIRED')
  })

  it('never downgrades VERIFIED via non-terminal states', () => {
    expect(resolveKycStatusUpdate('VERIFIED', 'NOT_STARTED')).toBeNull()
    expect(resolveKycStatusUpdate('VERIFIED', 'IN_PROGRESS')).toBeNull()
    expect(resolveKycStatusUpdate('VERIFIED', 'SUBMITTED')).toBeNull()
  })

  it('allows VERIFIED to be replaced by another terminal verdict (re-verification fails)', () => {
    expect(resolveKycStatusUpdate('VERIFIED', 'REJECTED')).toBe('REJECTED')
    expect(resolveKycStatusUpdate('VERIFIED', 'EXPIRED')).toBe('EXPIRED')
  })

  it('keeps REJECTED / EXPIRED sticky against soft re-opens', () => {
    expect(resolveKycStatusUpdate('REJECTED', 'NOT_STARTED')).toBeNull()
    expect(resolveKycStatusUpdate('REJECTED', 'IN_PROGRESS')).toBeNull()
    expect(resolveKycStatusUpdate('EXPIRED', 'NOT_STARTED')).toBeNull()
    expect(resolveKycStatusUpdate('EXPIRED', 'IN_PROGRESS')).toBeNull()
  })

  it('promotes REJECTED to SUBMITTED on a real re-submission', () => {
    expect(resolveKycStatusUpdate('REJECTED', 'SUBMITTED')).toBe('SUBMITTED')
    expect(resolveKycStatusUpdate('REJECTED', 'VERIFIED')).toBe('VERIFIED')
  })

  it('promotes EXPIRED to SUBMITTED / VERIFIED on a real re-submission', () => {
    expect(resolveKycStatusUpdate('EXPIRED', 'SUBMITTED')).toBe('SUBMITTED')
    expect(resolveKycStatusUpdate('EXPIRED', 'VERIFIED')).toBe('VERIFIED')
  })

  it('does not let SUBMITTED slide back to IN_PROGRESS or NOT_STARTED', () => {
    expect(resolveKycStatusUpdate('SUBMITTED', 'IN_PROGRESS')).toBeNull()
    expect(resolveKycStatusUpdate('SUBMITTED', 'NOT_STARTED')).toBeNull()
  })

  it('does not let IN_PROGRESS slide back to NOT_STARTED', () => {
    expect(resolveKycStatusUpdate('IN_PROGRESS', 'NOT_STARTED')).toBeNull()
  })
})
