import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    providerIdentityVerification: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    providerVerificationEvent: {
      create: vi.fn(),
    },
    provider: {
      update: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/db', () => ({ db: mockDb }))

describe('identity verification orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.providerIdentityVerification.update.mockImplementation(async (args) => ({
      id: args.where.id,
      ...args.data,
    }))
    mockDb.providerVerificationEvent.create.mockResolvedValue({ id: 'event-1' })
    mockDb.provider.update.mockResolvedValue({ id: 'provider-1' })
  })

  it('writes an event for every valid status transition', async () => {
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'STARTED',
      decision: null,
    })

    const { transitionIdentityVerification } = await import('../../../lib/identity-verification/orchestrator')

    await expect(
      transitionIdentityVerification({
        verificationId: 'ver-1',
        toStatus: 'CONSENTED',
        actorId: 'provider-1',
        actorRole: 'provider',
        metadata: { source: 'pwa' },
      }),
    ).resolves.toMatchObject({ id: 'ver-1', status: 'CONSENTED' })

    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith({
      where: { id: 'ver-1' },
      data: expect.objectContaining({ status: 'CONSENTED' }),
    })
    expect(mockDb.providerVerificationEvent.create).toHaveBeenCalledWith({
      data: {
        verificationId: 'ver-1',
        fromStatus: 'STARTED',
        toStatus: 'CONSENTED',
        actorId: 'provider-1',
        actorRole: 'provider',
        decision: undefined,
        reasonCode: undefined,
        metadata: { source: 'pwa' },
      },
    })
  })

  it('rejects invalid lifecycle jumps', async () => {
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'STARTED',
      decision: null,
    })

    const { transitionIdentityVerification } = await import('../../../lib/identity-verification/orchestrator')

    await expect(
      transitionIdentityVerification({
        verificationId: 'ver-1',
        toStatus: 'PASSED',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    expect(mockDb.providerIdentityVerification.update).not.toHaveBeenCalled()
    expect(mockDb.providerVerificationEvent.create).not.toHaveBeenCalled()
  })

  it('syncs Provider.kycStatus when a verification passes', async () => {
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'NEEDS_MANUAL_REVIEW',
      decision: 'MANUAL_REVIEW',
    })

    const { transitionIdentityVerification } = await import('../../../lib/identity-verification/orchestrator')

    await transitionIdentityVerification({
      verificationId: 'ver-1',
      toStatus: 'PASSED',
      decision: 'PASS',
    })

    expect(mockDb.provider.update).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      data: { kycStatus: 'VERIFIED' },
    })
  })
})
