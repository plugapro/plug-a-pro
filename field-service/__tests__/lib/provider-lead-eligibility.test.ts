import { describe, expect, it } from 'vitest'
import {
  checkCanBeApproved,
  checkPhaseOneLeadDetailEligibility,
  checkProviderCanUnlockLead,
} from '../../lib/provider-lead-eligibility'

// Provider with NO grace, NO override, NOT VERIFIED. Used as the base
// "should be blocked when KYC is required" fixture; tweak fields per case.
const baseSubject = {
  active: true,
  verified: false,
  status: 'APPLICATION_PENDING',
  kycStatus: 'NOT_STARTED',
  createdAt: new Date('2026-07-01T00:00:00.000Z'), // post-cutoff
  kycGraceUntil: null,
  kycOverriddenAt: null,
}

describe('checkCanBeApproved', () => {
  describe('when kycRequired flag is OFF', () => {
    it('passes regardless of kycStatus (backwards compatible)', () => {
      const result = checkCanBeApproved(
        { ...baseSubject, kycStatus: 'NOT_STARTED' },
        { kycRequired: false, kycGraceEnabled: false },
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('when kycRequired flag is ON', () => {
    it('passes when kycStatus is VERIFIED', () => {
      const result = checkCanBeApproved(
        { ...baseSubject, kycStatus: 'VERIFIED' },
        { kycRequired: true, kycGraceEnabled: false },
      )
      expect(result.ok).toBe(true)
    })

    it('blocks NOT_STARTED with KYC_REQUIRED', () => {
      const result = checkCanBeApproved(
        { ...baseSubject, kycStatus: 'NOT_STARTED' },
        { kycRequired: true, kycGraceEnabled: false },
      )
      expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
    })

    it('blocks SUBMITTED (admin review pending) with KYC_REQUIRED', () => {
      const result = checkCanBeApproved(
        { ...baseSubject, kycStatus: 'SUBMITTED' },
        { kycRequired: true, kycGraceEnabled: false },
      )
      expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
    })

    it('blocks REJECTED even when grace flag is on', () => {
      const result = checkCanBeApproved(
        {
          ...baseSubject,
          kycStatus: 'REJECTED',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        { kycRequired: true, kycGraceEnabled: true },
      )
      expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
    })

    it('blocks EXPIRED even when grace flag is on', () => {
      const result = checkCanBeApproved(
        {
          ...baseSubject,
          kycStatus: 'EXPIRED',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        { kycRequired: true, kycGraceEnabled: true },
      )
      expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
    })

    describe('per-provider grace window', () => {
      it('passes when kycGraceUntil is in the future', () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
        const result = checkCanBeApproved(
          { ...baseSubject, kycStatus: 'NOT_STARTED', kycGraceUntil: future },
          { kycRequired: true, kycGraceEnabled: false },
        )
        expect(result.ok).toBe(true)
      })

      it('blocks when kycGraceUntil has already passed', () => {
        const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const result = checkCanBeApproved(
          { ...baseSubject, kycStatus: 'NOT_STARTED', kycGraceUntil: past },
          { kycRequired: true, kycGraceEnabled: false },
        )
        expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
      })

      it('blocks REJECTED even within per-provider grace', () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
        const result = checkCanBeApproved(
          { ...baseSubject, kycStatus: 'REJECTED', kycGraceUntil: future },
          { kycRequired: true, kycGraceEnabled: false },
        )
        expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
      })
    })

    describe('admin override', () => {
      it('passes when kycOverriddenAt is set', () => {
        const result = checkCanBeApproved(
          {
            ...baseSubject,
            kycStatus: 'NOT_STARTED',
            kycOverriddenAt: new Date('2026-06-18T00:00:00.000Z'),
          },
          { kycRequired: true, kycGraceEnabled: false },
        )
        expect(result.ok).toBe(true)
      })

      it('passes even for REJECTED when override is set (operator escape hatch with audit)', () => {
        const result = checkCanBeApproved(
          {
            ...baseSubject,
            kycStatus: 'REJECTED',
            kycOverriddenAt: new Date('2026-06-18T00:00:00.000Z'),
          },
          { kycRequired: true, kycGraceEnabled: false },
        )
        expect(result.ok).toBe(true)
      })
    })

    describe('legacy cohort grace (matching.kyc_grace_legacy_providers ON)', () => {
      it('passes a NOT_STARTED legacy provider created before the cutoff', () => {
        const result = checkCanBeApproved(
          {
            ...baseSubject,
            kycStatus: 'NOT_STARTED',
            createdAt: new Date('2026-05-01T00:00:00.000Z'), // pre-cutoff
          },
          { kycRequired: true, kycGraceEnabled: true },
        )
        expect(result.ok).toBe(true)
      })

      it('blocks a NOT_STARTED post-cutoff provider even with grace flag ON', () => {
        const result = checkCanBeApproved(
          {
            ...baseSubject,
            kycStatus: 'NOT_STARTED',
            createdAt: new Date('2026-07-01T00:00:00.000Z'), // post-cutoff
          },
          { kycRequired: true, kycGraceEnabled: true },
        )
        expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
      })
    })
  })
})

describe('checkPhaseOneLeadDetailEligibility (regression — unchanged behavior)', () => {
  it('blocks suspended providers with PROVIDER_NOT_ACTIVE', () => {
    const result = checkPhaseOneLeadDetailEligibility({
      active: true,
      verified: true,
      status: 'SUSPENDED',
    })
    expect(result).toEqual({ ok: false, code: 'PROVIDER_NOT_ACTIVE' })
  })

  it('blocks unverified providers with PROVIDER_NOT_APPROVED', () => {
    const result = checkPhaseOneLeadDetailEligibility({
      active: true,
      verified: false,
      status: 'APPLICATION_PENDING',
    })
    expect(result).toEqual({ ok: false, code: 'PROVIDER_NOT_APPROVED' })
  })

  it('passes ACTIVE + verified provider', () => {
    const result = checkPhaseOneLeadDetailEligibility({
      active: true,
      verified: true,
      status: 'ACTIVE',
    })
    expect(result.ok).toBe(true)
  })
})

describe('checkProviderCanUnlockLead (regression — unchanged behavior)', () => {
  it('blocks non-VERIFIED provider with KYC_REQUIRED when grace OFF', () => {
    const result = checkProviderCanUnlockLead(
      {
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'NOT_STARTED',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      false,
    )
    expect(result).toEqual({ ok: false, code: 'KYC_REQUIRED' })
  })

  it('passes legacy NOT_STARTED provider when grace ON', () => {
    const result = checkProviderCanUnlockLead(
      {
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'NOT_STARTED',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      true,
    )
    expect(result.ok).toBe(true)
  })

  it('passes VERIFIED provider regardless of grace', () => {
    const result = checkProviderCanUnlockLead(
      {
        active: true,
        verified: true,
        status: 'ACTIVE',
        kycStatus: 'VERIFIED',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      false,
    )
    expect(result.ok).toBe(true)
  })
})
