import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveToken, mockTransition, mockDb } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockTransition: vi.fn(),
  mockDb: {
    providerIdentityVerification: {
      update: vi.fn(),
    },
    providerIdentityDocument: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../../lib/provider-verification-token', () => ({
  resolveProviderVerificationToken: mockResolveToken,
}))

vi.mock('../../lib/identity-verification/orchestrator', () => ({
  transitionIdentityVerification: mockTransition,
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('provider identity verification PWA actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('IDENTITY_HASH_PEPPER', 'test-pepper')
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'STARTED',
      identityBasis: 'SA_ID',
    })
    mockTransition.mockResolvedValue({ id: 'ver-1' })
    mockDb.providerIdentityVerification.update.mockResolvedValue({ id: 'ver-1' })
    mockDb.providerIdentityDocument.findMany.mockResolvedValue([
      { documentKind: 'ID_FRONT' },
      { documentKind: 'SELFIE' },
    ])
  })

  it('accepts consent by resolving the token and moving into the consented state', async () => {
    const { acceptIdentityConsent } = await import('../../app/provider/verify/[token]/actions')

    await expect(acceptIdentityConsent('token-1')).resolves.toEqual({ ok: true })

    expect(mockResolveToken).toHaveBeenCalledWith('token-1')
    expect(mockTransition).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      toStatus: 'CONSENTED',
      actorId: 'provider-1',
      actorRole: 'provider',
      metadata: { consentAccepted: true },
      data: expect.objectContaining({ consentAcceptedAt: expect.any(Date) }),
    })
  })

  it('stores only hashed and masked identifier metadata', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'CONSENTED',
      identityBasis: 'SA_ID',
    })

    const { submitIdentityBasisAndIdentifier } = await import('../../app/provider/verify/[token]/actions')

    await expect(
      submitIdentityBasisAndIdentifier('token-1', {
        identityBasis: 'SA_ID',
        identifier: '8001015009087',
      }),
    ).resolves.toEqual({ ok: true })

    const updateArg = mockDb.providerIdentityVerification.update.mock.calls[0][0]
    expect(updateArg).toMatchObject({
      where: { id: 'ver-1' },
      data: expect.objectContaining({
        identityBasis: 'SA_ID',
        identifierHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        identifierLast4: '9087',
        dobDerived: new Date('1980-01-01T00:00:00.000Z'),
        genderDerived: 'male',
        citizenshipDerived: 'citizen',
      }),
    })
    expect(JSON.stringify(updateArg)).not.toContain('8001015009087')
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-1',
      toStatus: 'AWAITING_DOCUMENT',
    }))
  })

  it('returns a controlled validation result instead of throwing on an invalid identifier', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'CONSENTED',
      identityBasis: 'SA_ID',
    })

    const { submitIdentityBasisAndIdentifier } = await import('../../app/provider/verify/[token]/actions')

    const result = await submitIdentityBasisAndIdentifier('token-1', {
      identityBasis: 'SA_ID',
      identifier: '0000000000000',
    })

    expect(result.ok).toBe(false)
    expect(mockDb.providerIdentityVerification.update).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('returns a controlled validation result instead of throwing on malformed input', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'CONSENTED',
      identityBasis: 'SA_ID',
    })

    const { submitIdentityBasisAndIdentifier } = await import('../../app/provider/verify/[token]/actions')

    const result = await submitIdentityBasisAndIdentifier('token-1', {
      identityBasis: 'SA_ID',
      identifier: '12',
    })

    expect(result.ok).toBe(false)
    expect(mockDb.providerIdentityVerification.update).not.toHaveBeenCalled()
  })

  it('reports missing documents without throwing when continuing to selfie', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'AWAITING_DOCUMENT',
      identityBasis: 'SA_ID',
    })
    mockDb.providerIdentityDocument.findMany.mockResolvedValue([])

    const { submitIdentityDocuments } = await import('../../app/provider/verify/[token]/actions')

    const result = await submitIdentityDocuments('token-1')

    expect(result.ok).toBe(false)
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('treats a stale document step as already complete instead of forcing an invalid transition', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'AWAITING_SELFIE',
      identityBasis: 'SA_ID',
    })

    const { submitIdentityDocuments } = await import('../../app/provider/verify/[token]/actions')

    const result = await submitIdentityDocuments('token-1')

    expect(result.ok).toBe(true)
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('submits a complete document set for manual review without echoing identifiers', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      status: 'AWAITING_SELFIE',
      identityBasis: 'SA_ID',
    })

    const { submitIdentityVerificationForReview } = await import('../../app/provider/verify/[token]/actions')

    await expect(submitIdentityVerificationForReview('token-1')).resolves.toEqual({ ok: true })

    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-1',
      toStatus: 'NEEDS_MANUAL_REVIEW',
      decision: 'MANUAL_REVIEW',
      data: expect.objectContaining({ assuranceLevel: 'MEDIUM' }),
    }))
  })
})
