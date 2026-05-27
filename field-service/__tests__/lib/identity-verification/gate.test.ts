import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindFirst, mockCount } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCount: vi.fn(),
}))

vi.mock('../../../lib/db', () => ({
  db: {
    providerIdentityVerification: {
      findFirst: mockFindFirst,
      count: mockCount,
    },
  },
}))

describe('checkCanStartNewVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue(null)
    mockCount.mockResolvedValue(0)
  })

  it('resumes a non-terminal verification across channels before any block decision', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst.mockResolvedValueOnce({
      id: 'ver-in-progress',
      status: 'AWAITING_DOCUMENT',
      channel: 'WHATSAPP',
    })

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'GENERAL_IDENTITY' }),
    ).resolves.toEqual({
      ok: 'RESUME',
      verificationId: 'ver-in-progress',
      status: 'AWAITING_DOCUMENT',
      channel: 'WHATSAPP',
    })

    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('blocks general identity starts when the provider already has a passed verification', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ver-passed' })

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'GENERAL_IDENTITY' }),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'PROVIDER_ALREADY_VERIFIED',
    })

    expect(mockFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        providerId: 'provider-1',
        status: 'PASSED',
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('uses the high-assurance credit predicate for credit top-up purpose', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ver-high' })

    await expect(
      checkCanStartNewVerification('provider-1', {
        purpose: 'CREDIT_TOP_UP',
        now: new Date('2026-05-27T08:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'PROVIDER_ALREADY_VERIFIED',
    })

    expect(mockFindFirst).toHaveBeenNthCalledWith(2, {
      where: {
        providerId: 'provider-1',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'HIGH',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date('2026-05-27T08:00:00.000Z') } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })
  })

  it('allows a credit top-up verification when only low-assurance passed records exist', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockCount.mockResolvedValue(0)

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'CREDIT_TOP_UP' }),
    ).resolves.toEqual({ ok: 'CREATE' })
  })

  it('locks starts after three failed post-cutoff attempts', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst.mockResolvedValue(null)
    mockCount.mockResolvedValue(3)

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'GENERAL_IDENTITY' }),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'VERIFICATION_LOCKED',
    })

    expect(mockCount).toHaveBeenCalledWith({
      where: {
        providerId: 'provider-1',
        status: 'FAILED',
        countsTowardAttemptCap: true,
      },
    })
  })

  it('allows starts when old failed records do not count toward the attempt cap', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst.mockResolvedValue(null)
    mockCount.mockResolvedValue(2)

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'GENERAL_IDENTITY' }),
    ).resolves.toEqual({ ok: 'CREATE' })
  })

  it('uses an injected Prisma client when called inside a transaction', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    const txFindFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const txCount = vi.fn().mockResolvedValue(0)

    await expect(
      checkCanStartNewVerification('provider-1', {
        purpose: 'GENERAL_IDENTITY',
        client: {
          providerIdentityVerification: {
            findFirst: txFindFirst,
            count: txCount,
          },
        },
      }),
    ).resolves.toEqual({ ok: 'CREATE' })

    expect(txFindFirst).toHaveBeenCalledTimes(2)
    expect(txCount).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockCount).not.toHaveBeenCalled()
  })
})
