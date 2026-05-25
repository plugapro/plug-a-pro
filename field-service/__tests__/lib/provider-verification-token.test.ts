import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    providerIdentityVerification: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}))

describe('provider verification tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('IDENTITY_VERIFICATION_TOKEN_TTL_HOURS', '72')
    mockUpdate.mockImplementation(async (args) => ({
      id: args.where.id,
      ...args.data,
    }))
  })

  it('returns the raw token once and stores only its hash', async () => {
    const { issueProviderVerificationToken } = await import('../../lib/provider-verification-token')

    const result = await issueProviderVerificationToken({
      verificationId: 'ver-1',
      now: new Date('2026-05-25T10:00:00.000Z'),
    })

    expect(result.token).toMatch(/^[a-f0-9]{48}$/)
    expect(result.expiresAt).toEqual(new Date('2026-05-28T10:00:00.000Z'))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ver-1' },
      data: {
        accessTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        accessTokenExpiresAt: new Date('2026-05-28T10:00:00.000Z'),
        accessTokenLastUsedAt: null,
        accessTokenRevokedAt: null,
      },
    })
    expect(JSON.stringify(mockUpdate.mock.calls[0][0])).not.toContain(result.token)
  })

  it('resolves a valid token and records last used time', async () => {
    const { hashProviderVerificationToken, resolveProviderVerificationToken } = await import('../../lib/provider-verification-token')
    const token = 'a'.repeat(48)
    const now = new Date('2026-05-25T10:00:00.000Z')
    mockFindUnique.mockResolvedValue({
      id: 'ver-1',
      status: 'AWAITING_DOCUMENT',
      accessTokenHash: hashProviderVerificationToken(token),
      accessTokenExpiresAt: new Date('2026-05-25T11:00:00.000Z'),
      accessTokenRevokedAt: null,
    })

    await expect(resolveProviderVerificationToken(token, { now })).resolves.toMatchObject({
      id: 'ver-1',
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ver-1' },
      data: { accessTokenLastUsedAt: now },
    })
  })

  it('rejects expired tokens', async () => {
    const { hashProviderVerificationToken, resolveProviderVerificationToken } = await import('../../lib/provider-verification-token')
    const token = 'b'.repeat(48)
    mockFindUnique.mockResolvedValue({
      id: 'ver-1',
      status: 'AWAITING_DOCUMENT',
      accessTokenHash: hashProviderVerificationToken(token),
      accessTokenExpiresAt: new Date('2026-05-25T09:59:59.000Z'),
      accessTokenRevokedAt: null,
    })

    await expect(
      resolveProviderVerificationToken(token, { now: new Date('2026-05-25T10:00:00.000Z') }),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  })

  it('rejects revoked tokens', async () => {
    const { hashProviderVerificationToken, resolveProviderVerificationToken } = await import('../../lib/provider-verification-token')
    const token = 'c'.repeat(48)
    mockFindUnique.mockResolvedValue({
      id: 'ver-1',
      status: 'AWAITING_DOCUMENT',
      accessTokenHash: hashProviderVerificationToken(token),
      accessTokenExpiresAt: new Date('2026-05-25T11:00:00.000Z'),
      accessTokenRevokedAt: new Date('2026-05-25T09:00:00.000Z'),
    })

    await expect(resolveProviderVerificationToken(token)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
  })

  it('rejects terminal verification tokens', async () => {
    const { hashProviderVerificationToken, resolveProviderVerificationToken } = await import('../../lib/provider-verification-token')
    const token = 'd'.repeat(48)
    mockFindUnique.mockResolvedValue({
      id: 'ver-1',
      status: 'PASSED',
      accessTokenHash: hashProviderVerificationToken(token),
      accessTokenExpiresAt: new Date('2026-05-25T11:00:00.000Z'),
      accessTokenRevokedAt: null,
    })

    await expect(resolveProviderVerificationToken(token)).rejects.toMatchObject({ code: 'TOKEN_TERMINAL' })
  })
})
