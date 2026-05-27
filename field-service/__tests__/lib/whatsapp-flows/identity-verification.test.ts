import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSendButtons,
  mockSendList,
  mockSendText,
  mockTransition,
  mockSubmitAutomation,
  mockResolveConsentVendor,
  mockResolveConsentVendorForSubject,
  mockDownloadIdentityMedia,
  mockRecordConsent,
  mockIsEnabled,
  mockCheckCanStartNewVerification,
} = vi.hoisted(() => ({
  mockDb: {
    provider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    providerIdentityVerification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    providerIdentityDocument: {
      findFirst: vi.fn(),
    },
  },
  mockSendButtons: vi.fn(),
  mockSendList: vi.fn(),
  mockSendText: vi.fn(),
  mockTransition: vi.fn(),
  mockSubmitAutomation: vi.fn(),
  mockResolveConsentVendor: vi.fn(),
  mockResolveConsentVendorForSubject: vi.fn(),
  mockDownloadIdentityMedia: vi.fn(),
  mockRecordConsent: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockCheckCanStartNewVerification: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))
vi.mock('@/lib/identity-verification/gate', () => ({
  checkCanStartNewVerification: mockCheckCanStartNewVerification,
}))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendButtons: mockSendButtons,
  sendList: mockSendList,
  sendText: mockSendText,
}))
vi.mock('@/lib/identity-verification/orchestrator', () => ({
  transitionIdentityVerification: mockTransition,
  submitVerificationForAutomation: mockSubmitAutomation,
  resolveIdentityVerificationConsentVendor: mockResolveConsentVendor,
  resolveIdentityVerificationConsentVendorForSubject: mockResolveConsentVendorForSubject,
}))
vi.mock('@/lib/identity-verification/consent-service', () => ({
  recordConsentAcceptance: mockRecordConsent,
  renderIdentityConsentText: (vendorDisplayName: string) => `consent for ${vendorDisplayName}`,
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
    vi.stubEnv('IDENTITY_ENC_KEY', '12345678901234567890123456789012')
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
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-wa-1',
      status: 'AWAITING_DOCUMENT',
      identityBasis: 'SA_ID',
      channel: 'WHATSAPP',
    })
    mockDb.providerIdentityVerification.update.mockResolvedValue({ id: 'ver-wa-1' })
    mockDb.providerIdentityDocument.findFirst.mockResolvedValue(null)
    mockTransition.mockResolvedValue({ id: 'ver-wa-1' })
    mockSubmitAutomation.mockResolvedValue({
      verificationId: 'ver-wa-1',
      status: 'NEEDS_MANUAL_REVIEW',
      vendorKey: 'manual',
      vendorReference: 'manual:ver-wa-1',
      livenessUrl: null,
      livenessSessionExpiresAt: null,
    })
    mockResolveConsentVendor.mockResolvedValue({
      vendorKey: 'mock',
      vendorDisplayName: 'Mock identity provider',
    })
    mockResolveConsentVendorForSubject.mockResolvedValue({
      vendorKey: 'mock',
      vendorDisplayName: 'Mock identity provider',
    })
    mockRecordConsent.mockResolvedValue({ consentTextHash: 'hash-consent' })
    mockDownloadIdentityMedia.mockResolvedValue({ documentId: 'doc-1' })
    mockIsEnabled.mockResolvedValue(false)
    mockCheckCanStartNewVerification.mockResolvedValue({ ok: 'CREATE' })
  })

  it('starts with explicit consent before asking for identity documents', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_start', { type: 'button_reply', id: 'iv_start_whatsapp' }),
    )

    expect(mockSendButtons).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('Mock identity provider'),
      [
        { id: 'iv_consent_accept', title: 'I agree' },
        { id: 'iv_consent_decline', title: 'Not now' },
      ],
    )
    expect(result).toMatchObject({
      nextStep: 'pj_identity_consent',
      nextData: {
        identityConsentVendorKey: 'mock',
        identityConsentVendorDisplayName: 'Mock identity provider',
      },
    })
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
    expect(mockRecordConsent).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      vendorKey: 'mock',
      vendorDisplayName: 'Mock identity provider',
      consentText: 'consent for Mock identity provider',
      channel: 'WHATSAPP',
    }))
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

  it('creates through the shared gate when the fail-safe flag is enabled', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockCheckCanStartNewVerification.mockResolvedValue({ ok: 'CREATE' })
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_consent', { type: 'button_reply', id: 'iv_consent_accept' }),
    )

    expect(mockCheckCanStartNewVerification).toHaveBeenCalledWith('provider-1', {
      purpose: 'GENERAL_IDENTITY',
    })
    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      nextStep: 'pj_identity_basis',
      nextData: { identityVerificationId: 'ver-wa-1' },
    })
  })

  it('resumes an existing document step when the shared gate returns RESUME', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockCheckCanStartNewVerification.mockResolvedValue({
      ok: 'RESUME',
      verificationId: 'ver-existing',
      status: 'AWAITING_DOCUMENT',
      channel: 'PWA',
    })
    mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce({
      id: 'ver-existing',
      status: 'AWAITING_DOCUMENT',
      identityBasis: 'SA_ID',
      channel: 'PWA',
    })
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_consent', { type: 'button_reply', id: 'iv_consent_accept' }),
    )

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('photo of your South African ID'))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: 'ver-existing',
        identityVerificationBasis: 'SA_ID',
        identityVerificationDocumentKinds: ['ID_FRONT'],
      },
    })
  })

  it('accepts consent on an existing started verification instead of looping back to consent', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockCheckCanStartNewVerification.mockResolvedValue({
      ok: 'RESUME',
      verificationId: 'ver-started',
      status: 'STARTED',
      channel: 'WHATSAPP',
    })
    mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce({
      id: 'ver-started',
      status: 'STARTED',
      identityBasis: 'SA_ID',
      channel: 'WHATSAPP',
    })
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_consent', { type: 'button_reply', id: 'iv_consent_accept' }),
    )

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockRecordConsent).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-started',
      channel: 'WHATSAPP',
      acceptedByProviderId: 'provider-1',
    }))
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-started',
      toStatus: 'CONSENTED',
    }))
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-started',
      toStatus: 'AWAITING_IDENTIFIER',
    }))
    expect(mockSendList).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('Which document'),
      expect.any(Array),
      expect.objectContaining({ buttonLabel: 'Choose document' }),
    )
    expect(result).toMatchObject({
      nextStep: 'pj_identity_basis',
      nextData: { identityVerificationId: 'ver-started' },
    })
  })

  it('routes a resumed RETRY_REQUIRED verification to identifier capture instead of telling the provider to restart', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockCheckCanStartNewVerification.mockResolvedValue({
      ok: 'RESUME',
      verificationId: 'ver-retry',
      status: 'RETRY_REQUIRED',
      channel: 'PWA',
    })
    mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce({
      id: 'ver-retry',
      status: 'RETRY_REQUIRED',
      identityBasis: 'PASSPORT',
      channel: 'PWA',
    })
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_consent', { type: 'button_reply', id: 'iv_consent_accept' }),
    )

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('passport number'))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_identifier',
      nextData: {
        identityVerificationId: 'ver-retry',
        identityVerificationBasis: 'PASSPORT',
        identityVerificationDocumentKinds: ['PASSPORT_PHOTO_PAGE'],
      },
    })
  })

  it('stops when the shared gate blocks a new WhatsApp verification', async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockCheckCanStartNewVerification.mockResolvedValue({
      ok: false,
      reason: 'VERIFICATION_LOCKED',
      message: 'Identity verification is locked after multiple failed attempts. Please contact support.',
    })
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx('pj_identity_consent', { type: 'button_reply', id: 'iv_consent_accept' }),
    )

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      '+27711111111',
      'Identity verification is locked after multiple failed attempts. Please contact support.',
    )
    expect(result).toEqual({ nextStep: 'done', nextData: {} })
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
    expect(result).toMatchObject({
      nextStep: 'pj_identity_selfie',
      nextData: {
        identityVerificationDocumentIds: ['doc-1'],
      },
    })
    expect(JSON.stringify(result)).not.toContain('media-doc-1')
  })

  it('keeps waiting for identity media when text is sent at the document upload step', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'text', text: 'I sent it already' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockDownloadIdentityMedia).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_SELFIE',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('photo of your South African ID'))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: 'ver-wa-1',
        identityVerificationBasis: 'SA_ID',
        identityVerificationDocumentKinds: ['ID_FRONT'],
      },
    })
  })

  it('keeps the document upload step recoverable when media storage fails', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')
    const { IdentityDocumentMediaError } = await import('@/lib/identity-verification/document-media-errors')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockDownloadIdentityMedia.mockRejectedValueOnce(new IdentityDocumentMediaError({
      code: 'WHATSAPP_MEDIA_DOWNLOAD_FAILED',
      operation: 'whatsapp_media_download',
      message: 'WhatsApp media download failed',
      status: 410,
      mediaIdSuffix: 'pired-doc',
      mimeType: 'image/jpeg',
    }))

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'image', mediaId: 'media-expired-doc', mimeType: 'image/jpeg' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockDownloadIdentityMedia).toHaveBeenCalledWith({
      mediaId: 'media-expired-doc',
      verificationId: 'ver-wa-1',
      documentKind: 'ID_FRONT',
      maxSizeBytes: expect.any(Number),
    })
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_SELFIE',
    }))
    expect(warnSpy).toHaveBeenCalledWith(
      '[identity-verification:whatsapp] document media storage failed',
      expect.objectContaining({
        code: 'WHATSAPP_MEDIA_DOWNLOAD_FAILED',
        failedOperationName: 'whatsapp_media_download',
        mediaIdSuffix: 'pired-doc',
        mimeType: 'image/jpeg',
      }),
    )
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('media-expired-doc')
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining("couldn't save"))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationId: 'ver-wa-1',
        identityVerificationBasis: 'SA_ID',
        identityVerificationDocumentKinds: ['ID_FRONT'],
      },
    })
    warnSpy.mockRestore()
  })

  it('keeps the document upload step recoverable when WhatsApp media type is rejected', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')
    mockDownloadIdentityMedia.mockRejectedValueOnce(new Error('Unsupported media type: image/gif'))

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'document', mediaId: 'media-gif-doc', mimeType: 'image/gif' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockDownloadIdentityMedia).toHaveBeenCalledWith({
      mediaId: 'media-gif-doc',
      verificationId: 'ver-wa-1',
      documentKind: 'ID_FRONT',
      maxSizeBytes: expect.any(Number),
    })
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_SELFIE',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining("couldn't save"))
    expect(result).toMatchObject({ nextStep: 'pj_identity_document' })
  })

  it('continues from the saved document state when the document is already stored', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')
    mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce({ id: 'doc-existing' })

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'button_reply', id: 'flow_continue' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockDownloadIdentityMedia).not.toHaveBeenCalled()
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_SELFIE',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('selfie'))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_selfie',
      nextData: {
        identityVerificationDocumentIds: ['doc-existing'],
      },
    })
  })

  it('does not repeat the document transition when Continue arrives after state already advanced', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')
    mockDb.providerIdentityDocument.findFirst.mockResolvedValueOnce({ id: 'doc-existing' })
    mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce({ status: 'AWAITING_SELFIE' })

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'button_reply', id: 'flow_continue' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'AWAITING_SELFIE',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('selfie'))
    expect(result).toMatchObject({ nextStep: 'pj_identity_selfie' })
  })

  it('logs state update failures after a document save and lets the provider continue safely later', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTransition.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_document',
        { type: 'image', mediaId: 'media-doc-state-fail', mimeType: 'image/jpeg' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
          identityVerificationDocumentKinds: ['ID_FRONT'],
        },
      ),
    )

    expect(mockDownloadIdentityMedia).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      '[identity-verification:whatsapp] verification state update failed',
      expect.objectContaining({
        code: 'VERIFICATION_STATE_UPDATE_FAILED',
        failedOperationName: 'verification_state_update',
        verificationId: 'ver-wa-1',
        documentKind: 'ID_FRONT',
      }),
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('media-doc-state-fail')
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining("We saved your document"))
    expect(result).toMatchObject({
      nextStep: 'pj_identity_document',
      nextData: {
        identityVerificationDocumentIds: ['doc-1'],
      },
    })
    errorSpy.mockRestore()
  })

  it('submits selfie media to the verification automation orchestrator', async () => {
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
    expect(mockSubmitAutomation).toHaveBeenCalledWith('ver-wa-1')
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('review team'))
    expect(result).toEqual({ nextStep: 'done', nextData: {} })
  })

  it('sends a secure liveness link when automation requires liveness', async () => {
    mockSubmitAutomation.mockResolvedValueOnce({
      verificationId: 'ver-wa-1',
      status: 'AWAITING_LIVENESS',
      vendorKey: 'mock',
      vendorReference: 'mock:ver-wa-1',
      livenessUrl: 'https://app.test/provider/verify/token/liveness',
      livenessSessionExpiresAt: new Date('2026-05-26T18:00:00.000Z'),
    })
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_selfie',
        { type: 'image', mediaId: 'media-selfie-1', mimeType: 'image/jpeg' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
        },
      ),
    )

    expect(mockSendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('https://app.test/provider/verify/token/liveness'),
    )
    expect(mockSendText).not.toHaveBeenCalledWith('+27711111111', expect.stringContaining('mock/liveness'))
  })

  it('rejects document uploads at the selfie step and keeps waiting for a facial image', async () => {
    const { handleWhatsAppIdentityVerificationFlow } = await import('@/lib/whatsapp-flows/identity-verification')

    const result = await handleWhatsAppIdentityVerificationFlow(
      baseCtx(
        'pj_identity_selfie',
        { type: 'document', mediaId: 'media-selfie-pdf', mimeType: 'application/pdf' },
        {
          identityVerificationId: 'ver-wa-1',
          identityVerificationBasis: 'SA_ID',
        },
      ),
    )

    expect(mockDownloadIdentityMedia).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalledWith(expect.objectContaining({
      verificationId: 'ver-wa-1',
      toStatus: 'SUBMITTED',
    }))
    expect(mockSendText).toHaveBeenCalledWith('+27711111111', expect.stringContaining('selfie photo'))
    expect(result).toMatchObject({ nextStep: 'pj_identity_selfie' })
  })
})
