import { describe, expect, it } from 'vitest'

import {
  classifyProviderTier,
  type ProviderTierInput,
} from '@/lib/provider-tier'

// Helper to build a complete-profile, fully-verified provider input. Tests
// override individual fields to push the classifier into a specific tier.
const COMPLETE: ProviderTierInput = {
  verified: true,
  kycStatus: 'VERIFIED',
  status: 'ACTIVE',
  strikes: 0,
  name: 'Test Provider',
  phone: '+27821234567',
  email: 'test@example.com',
  payoutVerifiedAt: new Date('2026-01-01'),
  skills: ['plumbing'],
  equipmentTags: ['basic_tools'],
  serviceAreas: ['gauteng__johannesburg__jhb_west__honeydew'],
  identityAssurance: 'HIGH',
  hasApplication: false,
  applicationStatus: null,
}

describe('classifyProviderTier', () => {
  describe('PENDING_R1 (applications in review)', () => {
    it('classifies SUBMITTED application as PENDING_R1', () => {
      expect(
        classifyProviderTier({
          ...COMPLETE,
          status: 'APPLICATION_PENDING' as any,
          hasApplication: true,
          applicationStatus: 'SUBMITTED' as any,
        }),
      ).toBe('PENDING_R1')
    })

    it('classifies UNDER_REVIEW application as PENDING_R1', () => {
      expect(
        classifyProviderTier({
          ...COMPLETE,
          status: 'UNDER_REVIEW' as any,
          hasApplication: true,
          applicationStatus: 'UNDER_REVIEW' as any,
        }),
      ).toBe('PENDING_R1')
    })
  })

  describe('excluded (suspended, banned, archived)', () => {
    it.each(['SUSPENDED', 'BANNED', 'ARCHIVED'] as const)(
      'returns null for status=%s',
      (status) => {
        expect(
          classifyProviderTier({ ...COMPLETE, status: status as any }),
        ).toBeNull()
      },
    )
  })

  describe('R5 (high-risk incomplete)', () => {
    it('returns R5 when ACTIVE but kyc not VERIFIED', () => {
      expect(
        classifyProviderTier({
          ...COMPLETE,
          kycStatus: 'IN_PROGRESS' as any,
        }),
      ).toBe('R5')
    })

    it('returns R5 when ACTIVE but no payoutVerifiedAt', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, payoutVerifiedAt: null }),
      ).toBe('R5')
    })

    it('returns R5 when 3+ profile fields missing', () => {
      expect(
        classifyProviderTier({
          ...COMPLETE,
          name: '',
          phone: '',
          email: '',
        }),
      ).toBe('R5')
    })
  })

  describe('R4 (low-risk incomplete; 1–2 missing fields)', () => {
    it('returns R4 when exactly 1 profile field missing', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, skills: [] }),
      ).toBe('R4')
    })

    it('returns R4 when 2 profile fields missing', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, skills: [], equipmentTags: [] }),
      ).toBe('R4')
    })
  })

  describe('R3 (profile-complete, identityAssurance=LOW)', () => {
    it('returns R3 when profile complete + LOW assurance', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, identityAssurance: 'LOW' }),
      ).toBe('R3')
    })
  })

  describe('R2 (profile-complete, identityAssurance=MEDIUM)', () => {
    it('returns R2 when profile complete + MEDIUM assurance', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, identityAssurance: 'MEDIUM' }),
      ).toBe('R2')
    })
  })

  describe('R1 (top tier: HIGH assurance, zero strikes)', () => {
    it('returns R1 for the COMPLETE fixture', () => {
      expect(classifyProviderTier(COMPLETE)).toBe('R1')
    })

    it('demotes R1 → R2 if strikes > 0', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, strikes: 1 }),
      ).toBe('R2')
    })

    it('demotes R1 → R3 if identityAssurance is LOW', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, identityAssurance: 'LOW' }),
      ).toBe('R3')
    })

    it('treats unknown / null assurance as the lowest assurance bucket (R3)', () => {
      expect(
        classifyProviderTier({ ...COMPLETE, identityAssurance: null }),
      ).toBe('R3')
    })
  })
})
