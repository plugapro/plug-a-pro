import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockIssueToken,
  mockGetPublicAppUrl,
} = vi.hoisted(() => ({
  mockDb: {
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

describe('issueProviderApplicationVerificationLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
    mockDb.providerIdentityVerification.create.mockResolvedValue({
      id: 'ver-app-new',
      status: 'NOT_STARTED',
    })
    mockIssueToken.mockResolvedValue({
      token: 'tok',
      expiresAt: new Date('2026-07-07T10:00:00.000Z'),
    })
    mockGetPublicAppUrl.mockReturnValue('https://app.plugapro.co.za/provider/verify/tok')
  })

  it('creates a new verification with providerId null for an application-stage draft (create path)', async () => {
    const { issueProviderApplicationVerificationLink } = await import(
      '@/lib/identity-verification/application-link'
    )

    const result = await issueProviderApplicationVerificationLink({
      providerApplicationDraftId: 'd1',
      channel: 'WHATSAPP',
    })

    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledWith({
      data: {
        providerId: null,
        providerApplicationDraftId: 'd1',
        channel: 'WHATSAPP',
        identityBasis: 'SA_ID',
        status: 'NOT_STARTED',
        assuranceLevel: 'LOW',
        countsTowardAttemptCap: true,
      },
      select: { id: true, status: true },
    })
    expect(result.verificationId).toBe('ver-app-new')
    expect(result.verificationUrl).toContain('tok')
    expect(result.reused).toBe(false)
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('reuses an existing non-terminal verification for the same draft (reuse path)', async () => {
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue({
      id: 'ver-existing',
      status: 'AWAITING_DOCUMENT',
    })
    const { issueProviderApplicationVerificationLink } = await import(
      '@/lib/identity-verification/application-link'
    )

    const result = await issueProviderApplicationVerificationLink({
      providerApplicationDraftId: 'd1',
      channel: 'WHATSAPP',
    })

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockIssueToken).toHaveBeenCalledWith({
      verificationId: 'ver-existing',
      now: undefined,
    })
    expect(result.verificationId).toBe('ver-existing')
    expect(result.reused).toBe(true)
  })

  it('asserts create data has providerId: null — the key application-stage invariant', async () => {
    const { issueProviderApplicationVerificationLink } = await import(
      '@/lib/identity-verification/application-link'
    )

    await issueProviderApplicationVerificationLink({
      providerApplicationDraftId: 'd1',
      channel: 'WHATSAPP',
    })

    const createCall = mockDb.providerIdentityVerification.create.mock.calls[0][0]
    expect(createCall.data.providerId).toBeNull()
    expect(createCall.data.providerApplicationDraftId).toBe('d1')
  })
})
