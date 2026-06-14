import { describe, it, expect } from 'vitest'
import { KYC_GRACE_CUTOFF, isKycGrandfathered } from '@/lib/matching/kyc-grace'
import { checkProviderCanUnlockLead } from '@/lib/provider-lead-eligibility'

const before = new Date(KYC_GRACE_CUTOFF.getTime() - 1000)
const after = new Date(KYC_GRACE_CUTOFF.getTime() + 1000)
const approved = { active: true, verified: true, status: 'ACTIVE' as const }

describe('isKycGrandfathered', () => {
  it('grandfathers a pre-cutoff provider only when grace is on', () => {
    expect(isKycGrandfathered(before, true)).toBe(true)
    expect(isKycGrandfathered(before, false)).toBe(false)
  })
  it('never grandfathers a post-cutoff provider', () => {
    expect(isKycGrandfathered(after, true)).toBe(false)
  })
  it('handles null createdAt safely', () => {
    expect(isKycGrandfathered(null, true)).toBe(false)
  })
  it('never grandfathers a terminal-fail KYC status (REJECTED/EXPIRED), even pre-cutoff with grace on', () => {
    expect(isKycGrandfathered(before, true, 'REJECTED')).toBe(false)
    expect(isKycGrandfathered(before, true, 'EXPIRED')).toBe(false)
  })
  it('still grandfathers a pre-cutoff provider who simply has not completed KYC', () => {
    expect(isKycGrandfathered(before, true, 'NOT_STARTED')).toBe(true)
    expect(isKycGrandfathered(before, true, 'IN_PROGRESS')).toBe(true)
    expect(isKycGrandfathered(before, true, 'SUBMITTED')).toBe(true)
  })
})

describe('checkProviderCanUnlockLead KYC grace', () => {
  it('blocks a non-KYC provider when grace is off', () => {
    const r = checkProviderCanUnlockLead({ ...approved, kycStatus: 'NOT_STARTED', createdAt: before }, false)
    expect(r).toEqual({ ok: false, code: 'KYC_REQUIRED' })
  })
  it('admits a non-KYC pre-cutoff provider when grace is on', () => {
    const r = checkProviderCanUnlockLead({ ...approved, kycStatus: 'NOT_STARTED', createdAt: before }, true)
    expect(r).toEqual({ ok: true })
  })
  it('still blocks a non-KYC post-cutoff provider even when grace is on', () => {
    const r = checkProviderCanUnlockLead({ ...approved, kycStatus: 'NOT_STARTED', createdAt: after }, true)
    expect(r).toEqual({ ok: false, code: 'KYC_REQUIRED' })
  })
  it('always admits a VERIFIED provider regardless of grace', () => {
    expect(checkProviderCanUnlockLead({ ...approved, kycStatus: 'VERIFIED', createdAt: after }, false)).toEqual({ ok: true })
  })
  it('blocks a REJECTED pre-cutoff provider even when grace is on (PII boundary)', () => {
    const r = checkProviderCanUnlockLead({ ...approved, kycStatus: 'REJECTED', createdAt: before }, true)
    expect(r).toEqual({ ok: false, code: 'KYC_REQUIRED' })
  })
  it('blocks an EXPIRED pre-cutoff provider even when grace is on', () => {
    const r = checkProviderCanUnlockLead({ ...approved, kycStatus: 'EXPIRED', createdAt: before }, true)
    expect(r).toEqual({ ok: false, code: 'KYC_REQUIRED' })
  })
})
