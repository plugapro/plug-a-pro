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

  it('blocks general identity starts when the LATEST row is a current (unexpired) pass', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-passed',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'MEDIUM',
        expiresAt: null,
      })

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'GENERAL_IDENTITY' }),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'PROVIDER_ALREADY_VERIFIED',
    })
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('allows general re-verification when an old PASS is superseded by a newer adverse row (deadlock case)', async () => {
    // Audit finding: the general path blocked on ANY historical PASSED row,
    // so a provider whose latest row is FAILED/EXPIRED was told "already
    // verified" and refused a fresh link — while the credit gate (latest-row)
    // said NOT verified. Deadlock. The general path must also read the LATEST
    // row and only block when THAT row is a current pass.
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-latest-failed',
        status: 'FAILED',
        decision: 'FAIL',
        assuranceLevel: null,
        expiresAt: null,
      })

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'GENERAL_IDENTITY' }),
    ).resolves.not.toMatchObject({ reason: 'PROVIDER_ALREADY_VERIFIED' })
  })

  it('allows general re-verification when the latest pass has expired', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-expired',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'HIGH',
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      })

    await expect(
      checkCanStartNewVerification('provider-1', {
        purpose: 'GENERAL_IDENTITY',
        now: new Date('2026-07-05T00:00:00.000Z'),
      }),
    ).resolves.not.toMatchObject({ reason: 'PROVIDER_ALREADY_VERIFIED' })
  })

  it('allows credit top-up re-verification when an old pass is superseded by a newer failed row (deadlock case)', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    // Provider history: old non-expired HIGH PASS row + newer FAILED row.
    // Latest-row semantics (matching credit-gate.ts) must return the FAILED row
    // and fall through to CREATE so the provider can re-verify.
    mockFindFirst
      .mockResolvedValueOnce(null) // no in-progress verification
      .mockResolvedValueOnce({
        id: 'ver-failed-latest',
        providerId: 'provider-1',
        status: 'FAILED',
        decision: 'FAIL',
        assuranceLevel: 'HIGH',
        expiresAt: null,
      })
    mockCount.mockResolvedValue(1)

    await expect(
      checkCanStartNewVerification('provider-1', {
        purpose: 'CREDIT_TOP_UP',
        now: new Date('2026-05-27T08:00:00.000Z'),
      }),
    ).resolves.toEqual({ ok: 'CREATE' })

    expect(mockFindFirst).toHaveBeenNthCalledWith(2, {
      where: { providerId: 'provider-1' },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        providerId: true,
        status: true,
        decision: true,
        assuranceLevel: true,
        expiresAt: true,
      },
    })
  })

  it('blocks credit top-up starts when the latest row is a current high-assurance pass', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-high-latest',
        providerId: 'provider-1',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'HIGH',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      })

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
      where: { providerId: 'provider-1' },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        providerId: true,
        status: true,
        decision: true,
        assuranceLevel: true,
        expiresAt: true,
      },
    })
    expect(mockCount).not.toHaveBeenCalled()
  })

  it('allows credit top-up re-verification when the latest pass has expired', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-expired-pass',
        providerId: 'provider-1',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'HIGH',
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
      })
    mockCount.mockResolvedValue(0)

    await expect(
      checkCanStartNewVerification('provider-1', {
        purpose: 'CREDIT_TOP_UP',
        now: new Date('2026-05-27T08:00:00.000Z'),
      }),
    ).resolves.toEqual({ ok: 'CREATE' })
  })

  it('allows credit top-up re-verification when the latest pass is only low assurance', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-low-pass',
        providerId: 'provider-1',
        status: 'PASSED',
        decision: 'PASS',
        assuranceLevel: 'LOW',
        expiresAt: null,
      })
    mockCount.mockResolvedValue(0)

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'CREDIT_TOP_UP' }),
    ).resolves.toEqual({ ok: 'CREATE' })
  })

  it('still locks credit top-up starts after three counted failures when the latest row is adverse', async () => {
    const { checkCanStartNewVerification } = await import('../../../lib/identity-verification/gate')
    mockFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'ver-failed-latest',
        providerId: 'provider-1',
        status: 'FAILED',
        decision: 'FAIL',
        assuranceLevel: 'HIGH',
        expiresAt: null,
      })
    mockCount.mockResolvedValue(3)

    await expect(
      checkCanStartNewVerification('provider-1', { purpose: 'CREDIT_TOP_UP' }),
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
