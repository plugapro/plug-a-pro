import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockIsEnabled,
} = vi.hoisted(() => ({
  mockDb: {
    providerApplication: {
      findUnique: vi.fn(),
    },
    providerIdentityVerification: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    providerIdentityDocument: {
      create: vi.fn(),
    },
  },
  mockIsEnabled: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

const APPLICATION_ID = 'app-1'
const PROVIDER_ID = 'provider-1'

function baseApplication(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: APPLICATION_ID,
    providerId: PROVIDER_ID,
    idNumber: '8001015009087', // SA ID (13 digits)
    attachments: [
      {
        id: 'att-doc',
        label: 'provider_id_document',
        blobKey: 'wa/2026/01/doc.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100_000,
      },
      {
        id: 'att-selfie',
        label: 'provider_id_selfie',
        blobKey: 'wa/2026/01/selfie.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 80_000,
      },
    ],
    ...overrides,
  }
}

describe('promoteApplicationCapturesToVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockDb.providerApplication.findUnique.mockResolvedValue(baseApplication())
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue(null)
    mockDb.providerIdentityVerification.create.mockResolvedValue({ id: 'ver-1' })
    mockDb.providerIdentityDocument.create.mockResolvedValue({ id: 'doc-1' })
  })

  it('skips entirely when the flag is OFF (default)', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(result).toEqual({ outcome: 'flag_off' })
    expect(mockDb.providerApplication.findUnique).not.toHaveBeenCalled()
    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockDb.providerIdentityDocument.create).not.toHaveBeenCalled()
  })

  it('creates a SUBMITTED ProviderIdentityVerification when flag is ON and captures are present', async () => {
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledTimes(1)
    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: PROVIDER_ID,
        providerApplicationId: APPLICATION_ID,
        channel: 'WHATSAPP',
        identityBasis: 'SA_ID',
        status: 'SUBMITTED',
        assuranceLevel: 'LOW',
      }),
      select: { id: true },
    })
    expect(result).toMatchObject({ outcome: 'created', verificationId: 'ver-1' })
  })

  it('derives identityBasis=PASSPORT when idNumber is not 13 digits', async () => {
    mockDb.providerApplication.findUnique.mockResolvedValue(
      baseApplication({ idNumber: 'A1234567' }),
    )
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identityBasis: 'PASSPORT',
      }),
      select: { id: true },
    })
  })

  it('creates ProviderIdentityDocument rows tied to the new verification for doc + selfie', async () => {
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(mockDb.providerIdentityDocument.create).toHaveBeenCalledTimes(2)
    const calls = mockDb.providerIdentityDocument.create.mock.calls.map((c) => c[0].data.documentKind)
    expect(calls).toEqual(expect.arrayContaining(['ID_FRONT', 'SELFIE']))
  })

  it('is idempotent: if a verification already exists for the provider, no new row is created', async () => {
    mockDb.providerIdentityVerification.findFirst.mockResolvedValue({ id: 'ver-existing' })

    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(mockDb.providerIdentityDocument.create).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'already_exists', verificationId: 'ver-existing' })
  })

  it('skips creation when captured KYC data is missing (no idNumber)', async () => {
    mockDb.providerApplication.findUnique.mockResolvedValue(
      baseApplication({ idNumber: null }),
    )
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'no_captures' })
  })

  it('skips creation when both document and selfie attachments are missing', async () => {
    mockDb.providerApplication.findUnique.mockResolvedValue(
      baseApplication({ attachments: [] }),
    )
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'no_captures' })
  })

  it('fail-safe: when the verification create throws, returns a failure outcome (does not throw)', async () => {
    mockDb.providerIdentityVerification.create.mockRejectedValue(new Error('db boom'))
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(result).toMatchObject({ outcome: 'error' })
  })

  it('fail-safe: document creation failure does not throw and still returns created outcome', async () => {
    mockDb.providerIdentityDocument.create.mockRejectedValue(new Error('doc boom'))
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    // Verification row was created; document copies failed best-effort.
    expect(mockDb.providerIdentityVerification.create).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outcome: 'created', verificationId: 'ver-1' })
  })

  it('returns a no_application outcome when the application cannot be found', async () => {
    mockDb.providerApplication.findUnique.mockResolvedValue(null)
    const { promoteApplicationCapturesToVerification } = await import(
      '@/lib/identity-verification/promote-application-captures'
    )

    const result = await promoteApplicationCapturesToVerification({
      applicationId: APPLICATION_ID,
      providerId: PROVIDER_ID,
    })

    expect(result).toEqual({ outcome: 'no_application' })
    expect(mockDb.providerIdentityVerification.create).not.toHaveBeenCalled()
  })
})
