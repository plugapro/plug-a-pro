import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendButtons, mockSendList, mockSendText, mockTransition, mockDownloadIdentityMedia } = vi.hoisted(() => ({
  mockDb: {
    provider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    providerIdentityVerification: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  mockSendButtons: vi.fn(),
  mockSendList: vi.fn(),
  mockSendText: vi.fn(),
  mockTransition: vi.fn(),
  mockDownloadIdentityMedia: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendButtons: mockSendButtons,
  sendList: mockSendList,
  sendText: mockSendText,
}))
vi.mock('@/lib/identity-verification/orchestrator', () => ({
  transitionIdentityVerification: mockTransition,
}))
vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppIdentityDocument: mockDownloadIdentityMedia,
}))

const baseCtx = (step: string, reply: Record<string, unknown>, data: Record<string, unknown> = {}) => ({
  phone: '+27711111111',
  flow: 'provider_journey' as const,
  step: step as any,
  data: data as any,
  reply: reply as any,
})

describe('WhatsApp identity verification fallback flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('IDENTITY_HASH_PEPPER', 'test-pepper')
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-1',
      phone: '+27711111111',
      kycStatus: 'NOT_STARTED',
    })
    mockDb.provider.findMany.mockResolvedValue([])
    mockDb.providerIdentityVerification.create.mockResolvedValue({
      id: 'ver-wa-1',
      status: 'NOT_STARTED',
    })
    mockDb.providerIdentityVerification.update.mockResolvedValue({ id: 'ver-wa-1' })
    mockTransition.mockResolvedValue({ id: 'ver-wa-1' })
    mockDownloadIdentityMedia.mockResolvedValue({ documentId: 'doc-1' })
  })

  it('starts with explicit consent before asking for identity documents', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_start', { type: 'button_reply', id: 'iv_start_whatsapp' }),
    )

    expect(mockSendButtons).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('POPIA'),
      [
        { id: 'iv_consent_accept', title: 'I agree' },
        { id: 'iv_consent_decline', title: 'Not now' },
      ],
    )
    expect(result).toEqual({ nextStep: 'pj_identity_consent' })
    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
  })

  it('creates a LOW-assurance WhatsApp verification case after consent', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_consent', { type: 'button_reply', id: 'iv_consent_accept' }),
    )

    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledWith({
      data: {
        providerId: 'provider-1',
        providerApplicationId: null,
        channel: 'WHATSAPP',
        identityBasis: 'SA_ID',
        status: 'NOT_STARTED',
        assuranceLevel: 'LOW',
      },
      select: { id: true, status: true },
    })
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'STARTED',
      actorId: 'provider-1',
      actorRole: 'provider',
    }))
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'CONSENTED',
      data: expect.objectContaining({ consentAcceptedAt: expect.any(Date) }),
    }))
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_IDENTIFIER',
    }))
    expect(mockSendList).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('Which document'),
      expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'iv_basis_SA_ID' }),
            expect.objectContaining({ id: 'iv_basis_PASSPORT' }),
            expect.objectContaining({ id: 'iv_basis_ASYLUM_PERMIT' }),
          ]),
        }),
      ]),
      expect.objectContaining({ buttonLabel: 'Choose document' }),
    )
    expect(result).toMatchObject({
      nextStep: 'pj_identity_basis',
      nextData: { identityVerificationId: 'ver-wa-1' },
    })
  })

  it('hashes the entered identifier without storing the raw value in conversation data', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_identifier',
        { type: 'text', text: '8001015009087' },
        { identityVerificationId: 'ver-wa-1', identityVerificationBasis: 'SA_ID' },
      ),
    )

    const updateArg = mockDb.providerIdentityVerification.update.mock.calls[0][0]
    expect(updateArg).toMatchObject({
      where: { id: 'ver-wa-1' },
      data: expect.objectContaining({
        identifierHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        identifierLast4: '9087',
        dobDerived: new Date('1980-01-01T00:00:00.000Z'),
        genderDerived: 'male',
        citizenshipDerived: 'citizen',
      }),
    })
    expect(JSON.stringify(updateArg)).not.toContain('8001015009087')
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_DOCUMENT',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('photo of your South African ID'))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationDocumentKinds: ['ID_FRONT'],
      },
    })
  })

  it('stores document media privately and then requests a selfie', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'image', mediaId: 'media-doc-1', mimeType: 'image/jpeg' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockDownloadIdentityMedia).toHaveBeenCalledWith({
      mediaId: 'media-doc-1',
      verificationId: 'ver-wa-1',
      documentKind: 'ID_FRONT',
      maxSizeBytes: expect.any(Number),
    })
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_SELFIE',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('selfie'))
    expect(result).toMatchObject({ nextStep: 'pj_identity_selfie' })
  })

  it('submits selfie media as LOW-assurance manual review', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_selfie',
        { type: 'image', mediaId: 'media-selfie-1', mimeType: 'image/jpeg' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
        },
      ),
    )

    expect(mockDownloadIdentityMedia).toHaveBeenCalledWith({
      mediaId: 'media-selfie-1',
      verificationId: 'ver-wa-1',
      documentKind: 'SELFIE',
      maxSizeBytes: expect.any(Number),
    })
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'SUBMITTED',
      metadata: { submittedFrom: 'whatsapp' },
    }))
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'NEEDS_MANUAL_REVIEW',
      decision: 'MANUAL_REVIEW',
      data: { assuranceLevel: 'LOW' },
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('manual review'))
    expect(result).toEqual({ nextStep: 'done', nextData: {} })
  })
})
