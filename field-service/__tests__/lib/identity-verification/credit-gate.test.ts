import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindFirst, mockIsEnabled } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockIsEnabled: vi.fn(),
}))

vi.mock('../../../lib/db', () => ({
  db: {
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

  it('blocks providers without a high-assurance passed verification', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    mockFindFirst.mockResolvedValue(null)

    await expect(assertIdentityVerifiedForCredits('provider-1')).rejects.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
    })
  })

  it('uses the supplied Prisma client when checking inside a transaction', async () => {
    const { assertIdentityVerifiedForCredits } = await import('../../../lib/identity-verification/credit-gate')
    const txFindFirst = vi.fn().mockResolvedValue({ id: 'ver-tx', providerId: 'provider-1' })

    await expect(
      assertIdentityVerifiedForCredits('provider-1', {
        providerIdentityVerification: { findFirst: txFindFirst },
      }),
    ).resolves.toEqual({
      providerId: 'provider-1',
      verificationId: 'ver-tx',
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
})
