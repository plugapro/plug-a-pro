import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KycStatus, ProviderStatus } from '@prisma/client'
import { isProviderEligibleForCredits } from '../../lib/identity-verification/credit-gate'
import { invalidateFlagCache } from '../../lib/flags'

// Shared mock DB

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    provider: {
      findUnique: vi.fn(),
    },
    providerIdentityVerification: {
      findFirst: vi.fn(),
    },
  }
  return { mockDb }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))

// Helpers

function makeVerification(overrides: Partial<{ expiresAt: Date | null }> = {}) {
  return {
    id: 'verification-1',
    providerId: 'provider-1',
    expiresAt: null,
    ...overrides,
  }
}

function makeProvider(overrides: Partial<{
  active: boolean
  verified: boolean
  status: ProviderStatus
  kycStatus: KycStatus
  suspendedUntil: Date | null
}> = {}) {
  return {
    active: true,
    verified: true,
    status: ProviderStatus.ACTIVE,
    kycStatus: KycStatus.VERIFIED,
    suspendedUntil: null,
    ...overrides,
  }
}

// Tests

describe('isProviderEligibleForCredits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateFlagCache()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    invalidateFlagCache()
  })

  describe('when the provider.identity.verification flag is off', () => {
    beforeEach(() => {
      vi.stubEnv('FEATURE_FLAGS', JSON.stringify({ 'provider.identity.verification': false }))
    })

    it('still rejects providers that are not identity verified', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.NOT_STARTED }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.provider.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'provider-1' } }),
      )
      expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('when the provider.identity.verification flag is on', () => {
    beforeEach(() => {
      vi.stubEnv('FEATURE_FLAGS', JSON.stringify({ 'provider.identity.verification': true }))
    })

    it('returns false when the provider is not found', async () => {
      mockDb.provider.findUnique.mockResolvedValue(null)
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
    })

    it('returns false when kycStatus is NOT_STARTED', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.NOT_STARTED }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
    })

    it('returns false when kycStatus is IN_PROGRESS', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.IN_PROGRESS }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
    })

    it('returns false when kycStatus is SUBMITTED', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.SUBMITTED }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
    })

    it('returns false when kycStatus is REJECTED', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.REJECTED }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
    })

    it('returns false when kycStatus is EXPIRED', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.EXPIRED }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
    })

    it('returns false when the provider profile is inactive', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ active: false }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
    })

    it('returns false when the provider profile is not marketplace approved', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ verified: false }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
    })

    it.each([ProviderStatus.APPLICATION_PENDING, ProviderStatus.UNDER_REVIEW, ProviderStatus.SUSPENDED, ProviderStatus.BANNED])(
      'returns false when provider status is %s',
      async (status) => {
        mockDb.provider.findUnique.mockResolvedValue(makeProvider({ status }))
        const result = await isProviderEligibleForCredits('provider-1', mockDb)
        expect(result).toBe(false)
        expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
      },
    )

    it('returns false when the provider has a current suspension window', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({
        suspendedUntil: new Date(Date.now() + 60_000),
      }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.providerIdentityVerification.findFirst).not.toHaveBeenCalled()
    })

    describe('when kycStatus is VERIFIED', () => {
      beforeEach(() => {
        mockDb.provider.findUnique.mockResolvedValue(makeProvider())
      })

      it('returns false when no high-assurance verification record exists', async () => {
        mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
        const result = await isProviderEligibleForCredits('provider-1', mockDb)
        expect(result).toBe(false)
      })

      it('returns true when a non-expiring PASSED/PASS/HIGH verification exists', async () => {
        mockDb.providerIdentityVerification.findFirst.mockResolvedValue(makeVerification())
        const result = await isProviderEligibleForCredits('provider-1', mockDb)
        expect(result).toBe(true)
      })

      it('returns true when verification has a future expiresAt', async () => {
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        mockDb.providerIdentityVerification.findFirst.mockResolvedValue(makeVerification({ expiresAt: future }))
        const result = await isProviderEligibleForCredits('provider-1', mockDb)
        expect(result).toBe(true)
      })

      it('queries providerIdentityVerification with the correct PASSED/PASS/HIGH where-clause', async () => {
        mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
        await isProviderEligibleForCredits('provider-1', mockDb)

        expect(mockDb.providerIdentityVerification.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              providerId: 'provider-1',
              status: 'PASSED',
              decision: 'PASS',
              assuranceLevel: 'HIGH',
            }),
          }),
        )
      })
    })
  })

  describe('flag absent (defaults to false)', () => {
    it('fails closed instead of treating missing config as top-up approval', async () => {
      mockDb.provider.findUnique.mockResolvedValue(makeProvider({ kycStatus: KycStatus.NOT_STARTED }))
      const result = await isProviderEligibleForCredits('provider-1', mockDb)
      expect(result).toBe(false)
      expect(mockDb.provider.findUnique).toHaveBeenCalled()
    })
  })
})
