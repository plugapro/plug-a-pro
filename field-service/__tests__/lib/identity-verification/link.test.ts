import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockIssueToken, mockGetPublicAppUrl } = vi.hoisted(() => ({
  mockDb: {
    provider: {
      findUnique: vi.fn(),
    },
    providerIdentityVerification: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
  mockIssueToken: vi.fn(),
  mockGetPublicAppUrl: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/provider-verification-token', () => ({
  issueProviderVerificationToken: mockIssueToken,
}))
vi.mock('@/lib/provider-credit-copy', () => ({
  getPublicAppUrl: mockGetPublicAppUrl,
}))

describe('issueProviderIdentityVerificationLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.provider.findUnique.mockResolvedValue({ id: 'provider-1' })
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
    mockDb.providerIdentityVerification.create.mockResolvedValue({
      id: 'ver-new',
      status: 'NOT_STARTED',
    })
    mockIssueToken.mockResolvedValue({
      token: 'secure-token',
      expiresAt: new Date('2026-05-28T10:00:00.000Z'),
    })
    mockGetPublicAppUrl.mockReturnValue('https://app.plugapro.co.za/provider/verify/secure-token')
  })

  it('creates a new PWA verification case and returns the tokenized public URL', async () => {
    const { issueProviderIdentityVerificationLink } = await import('@/lib/identity-verification/link')

    const result = await issueProviderIdentityVerificationLink({ providerId: 'provider-1' })

    expect(mockDb.provider.findUnique).toHaveBeenCalledWith({
      where: { id: 'provider-1' },
      select: { id: true },
    })
    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledWith({
      data: {
        providerId: 'provider-1',
        providerApplicationId: null,
        channel: 'PWA',
        identityBasis: 'SA_ID',
        status: 'NOT_STARTED',
        assuranceLevel: 'LOW',
      },
      select: { id: true, status: true },
    })
    expect(mockDb.providerIdentityVerification.findFirst).toHaveBeenCalledWith({
      where: {
        providerId: 'provider-1',
        channel: 'PWA',
        status: {
          in: expect.arrayContaining(['NOT_STARTED', 'AWAITING_DOCUMENT', 'NEEDS_MANUAL_REVIEW']),
        },
      },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
    })
    expect(mockIssueToken).toHaveBeenCalledWith({
      verificationId: 'ver-new',
      now: undefined,
    })
    expect(result).toMatchObject({
      verificationId: 'ver-new',
      verificationUrl: 'https://app.plugapro.co.za/provider/verify/secure-token',
      reused: false,
    })
  })

  it('reuses an existing non-terminal verification instead of creating duplicates', async () => {
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue({
      id: 'ver-open',
      status: 'AWAITING_DOCUMENT',
    })
    const { issueProviderIdentityVerificationLink } = await import('@/lib/identity-verification/link')

    const result = await issueProviderIdentityVerificationLink({ providerId: 'provider-1' })

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockIssueToken).toHaveBeenCalledWith({
      verificationId: 'ver-open',
      now: undefined,
    })
    expect(result).toMatchObject({
      verificationId: 'ver-open',
      reused: true,
      status: 'AWAITING_DOCUMENT',
    })
  })
})
