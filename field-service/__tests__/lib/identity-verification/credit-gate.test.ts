import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindFirst, mockProviderFindUnique, mockIsEnabled } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockProviderFindUnique: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

vi.mock('../../../lib/db', () => ({
  db: {
    provider: {
      findUnique: mockProviderFindUnique,
    },
    providerIdentityVerification: {
      findFirst: mockFindFirst,
    },
  },
}))

vi.mock('../../../lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

describe('paid credit identity gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockProviderFindUnique.mockResolvedValue({ kycStatus: 'VERIFIED' })
  })

  it('passes when latest verification is high assurance and not expired', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue({ id: 'ver-1', providerId: 'provider-1' })

    await expect(assertIdentityVerifiedForCredits('provider-1')).resolves.toEqual({
      providerId: 'provider-1',
      verificationId: 'ver-1',
    })

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        providerId: 'provider-1',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'HIGH',
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, providerId: true },
    })
  })

  it('builds one shared high-assurance verification predicate for display and enforcement gates', async () => {
    const { buildHighAssuranceCreditVerificationWhere } = await import('../../../lib/identity-verification/credit-gate')

    const where = buildHighAssuranceCreditVerificationWhere('provider-1')

    expect(where).toEqual({
      providerId: 'provider-1',
      status: 'PASSED',
      decision: 'PASS',
      assuranceLevel: 'HIGH',
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    })
  })

  it('blocks providers without a high-assurance passed verification', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue(null)

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
  })

  it('blocks providers whose coarse KYC status is not verified even with high-assurance verification', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockProviderFindUnique.mockResolvedValue({ kycStatus: 'SUBMITTED' })
    mockFindFirst.mockResolvedValue({ id: 'ver-1', providerId: 'provider-1' })

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('uses the supplied Prisma client when checking inside a transaction', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    const txFindFirst = vi.fn().mockResolvedValue({ id: 'ver-tx', providerId: 'provider-1' })
    const txProviderFindUnique = vi.fn().mockResolvedValue({ kycStatus: 'VERIFIED' })

    await expect(
      assertIdentityVerifiedForCredits('provider-1', {
        provider: { findUnique: txProviderFindUnique },
        providerIdentityVerification: { findFirst: txFindFirst },
      }),
    ).resolves.toEqual({
      providerId: 'provider-1',
      verificationId: 'ver-tx',
    })

    expect(txProviderFindUnique).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      select: { kycStatus: true },
    })
    expect(txFindFirst).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('short-circuits when the identity verification feature flag is disabled', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockIsEnabled.mockResolvedValue(false)

    await expect(assertIdentityVerifiedForCredits('provider-1')).resolves.toEqual({
      providerId: 'provider-1',
      verificationId: null,
    })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('reports provider eligible for credit display when kyc status and high-assurance verification both pass', async () => {
    const { isProviderEligibleForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue({ id: 'ver-1', providerId: 'provider-1' })

    await expect(isProviderEligibleForCredits('provider-1')).resolves.toBe(true)

    expect(mockProviderFindUnique).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      select: { kycStatus: true },
    })
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        providerId: 'provider-1',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'HIGH',
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, providerId: true },
    })
  })

  it('reports provider ineligible for credit display when only low-assurance verification exists', async () => {
    const { isProviderEligibleForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue(null)

    await expect(isProviderEligibleForCredits('provider-1')).resolves.toBe(false)
  })

  it('reports provider ineligible for credit display when kyc status is not verified', async () => {
    const { isProviderEligibleForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockProviderFindUnique.mockResolvedValue({ kycStatus: 'SUBMITTED' })

    await expect(isProviderEligibleForCredits('provider-1')).resolves.toBe(false)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })
})
