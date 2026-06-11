import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindFirst, mockProviderFindUnique, mockIsEnabled } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockProviderFindUnique: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

const activeVerifiedProvider = {
  active: true,
  verified: true,
  status: 'ACTIVE',
  kycStatus: 'VERIFIED',
  suspendedUntil: null,
}

const providerCreditSelect = {
  active: true,
  verified: true,
  status: true,
  kycStatus: true,
  suspendedUntil: true,
}

const latestVerificationSelect = {
  id: true,
  providerId: true,
  status: true,
  decision: true,
  assuranceLevel: true,
  expiresAt: true,
}

const passingVerification = {
  id: 'ver-1',
  providerId: 'provider-1',
  status: 'PASSED',
  decision: 'PASS',
  assuranceLevel: 'HIGH',
  expiresAt: null,
}

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
	    mockProviderFindUnique.mockResolvedValue(activeVerifiedProvider)
	  })

  it('passes when latest verification is high assurance and not expired', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue(passingVerification)

    await expect(assertIdentityVerifiedForCredits('provider-1')).resolves.toEqual({
      providerId: 'provider-1',
      verificationId: 'ver-1',
    })

    // The gate fetches the provider's LATEST verification row (any outcome) and
    // validates the pass predicate in code - so a newer adverse record supersedes
    // an older PASS.
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { providerId: 'provider-1' },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
      select: latestVerificationSelect,
    })
  })

  it('blocks when the latest verification is adverse even if an older PASS exists', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    // findFirst returns the LATEST row only; a newer FAILED supersedes any old PASS.
    mockFindFirst.mockResolvedValue({
      id: 'ver-2',
      providerId: 'provider-1',
      status: 'FAILED',
      decision: 'FAIL',
      assuranceLevel: 'HIGH',
      expiresAt: null,
    })

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
  })

  it('blocks when the latest passing verification has expired', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue({
      ...passingVerification,
      expiresAt: new Date(Date.now() - 60_000),
    })

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
  })

  it('builds one shared high-assurance verification predicate for the resume/already-verified gate', async () => {
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
	    mockProviderFindUnique.mockResolvedValue({ ...activeVerifiedProvider, kycStatus: 'SUBMITTED' })
    mockFindFirst.mockResolvedValue(passingVerification)

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('uses the supplied Prisma client when checking inside a transaction', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    const txFindFirst = vi.fn().mockResolvedValue({ ...passingVerification, id: 'ver-tx' })
	    const txProviderFindUnique = vi.fn().mockResolvedValue(activeVerifiedProvider)

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
	      select: providerCreditSelect,
	    })
    expect(txFindFirst).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('does not short-circuit when the identity verification feature flag is disabled', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockIsEnabled.mockResolvedValue(false)
    mockFindFirst.mockResolvedValue(null)

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
    expect(mockFindFirst).toHaveBeenCalled()
  })

  it('reports provider eligible for credit display when kyc status and high-assurance verification both pass', async () => {
    const { isProviderEligibleForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue(passingVerification)

    await expect(isProviderEligibleForCredits('provider-1')).resolves.toBe(true)

	    expect(mockProviderFindUnique).toHaveBeenCalledWith({
	      where: { id: 'provider-1' },
	      select: providerCreditSelect,
	    })
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { providerId: 'provider-1' },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
      select: latestVerificationSelect,
    })
  })

  it('reports provider ineligible for credit display when only low-assurance verification exists', async () => {
    const { isProviderEligibleForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue(null)

    await expect(isProviderEligibleForCredits('provider-1')).resolves.toBe(false)
  })

  it('reports provider ineligible for credit display when kyc status is not verified', async () => {
    const { isProviderEligibleForCredits } = await import('../../../lib/identity-verification/credit-gate')
	    mockProviderFindUnique.mockResolvedValue({ ...activeVerifiedProvider, kycStatus: 'SUBMITTED' })

    await expect(isProviderEligibleForCredits('provider-1')).resolves.toBe(false)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })
})
