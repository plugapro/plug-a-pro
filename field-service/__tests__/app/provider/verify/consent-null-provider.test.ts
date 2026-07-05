/**
 * Regression lock: startHostedVerificationFromConsent must tolerate a
 * verification whose providerId is null (application-stage / draft-anchored
 * subject, created by issueProviderApplicationVerificationLink).
 *
 * This test proves that no db.provider lookup or update is attempted, and
 * that submitVerificationForAutomation is called — i.e. the Didit session
 * creation proceeds — when providerId is null and providerApplicationDraftId
 * is set.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveToken,
  mockTransition,
  mockSubmitAutomation,
  mockResolveConsentVendor,
  mockRecordConsent,
  mockDb,
} = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockTransition: vi.fn(),
  mockSubmitAutomation: vi.fn(),
  mockResolveConsentVendor: vi.fn(),
  mockRecordConsent: vi.fn(),
  mockDb: {
    providerIdentityVerification: {
      update: vi.fn(),
    },
    providerIdentityDocument: {
      findMany: vi.fn(),
    },
    provider: {
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

vi.mock('../../../../lib/provider-verification-token', () => ({
  resolveProviderVerificationToken: mockResolveToken,
}))

vi.mock('../../../../lib/identity-verification/orchestrator', () => ({
  transitionIdentityVerification: mockTransition,
  submitVerificationForAutomation: mockSubmitAutomation,
  resolveIdentityVerificationConsentVendor: mockResolveConsentVendor,
}))

vi.mock('../../../../lib/identity-verification/consent-service', () => ({
  recordConsentAcceptance: mockRecordConsent,
  renderIdentityConsentText: (vendorDisplayName: string) => `consent for ${vendorDisplayName}`,
}))

vi.mock('../../../../lib/db', () => ({ db: mockDb }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/** A null-provider, draft-anchored verification row at the CONSENTED stage. */
const NULL_PROVIDER_VERIFICATION = {
  id: 'ver-app-1',
  providerId: null,
  providerApplicationDraftId: 'd1',
  status: 'CONSENTED',
  consentVendorKey: 'didit',
  identityBasis: null,
}

describe('startHostedVerificationFromConsent — null-provider (application-stage) subject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveToken.mockResolvedValue({ ...NULL_PROVIDER_VERIFICATION })
    mockResolveConsentVendor.mockResolvedValue({
      vendorKey: 'didit',
      vendorDisplayName: 'Didit',
    })
    mockTransition.mockResolvedValue({ id: 'ver-app-1' })
    mockSubmitAutomation.mockResolvedValue({
      verificationId: 'ver-app-1',
      status: 'AWAITING_LIVENESS',
      vendorKey: 'didit',
      vendorReference: 'didit-ref-1',
      livenessUrl: 'https://did.it/liveness/abc',
      livenessSessionExpiresAt: new Date(Date.now() + 3_600_000),
    })
  })

  it('returns { ok: true } — a Didit session is submitted for automation', async () => {
    const { startHostedVerificationFromConsent } = await import(
      '../../../../app/provider/verify/[token]/actions'
    )

    const result = await startHostedVerificationFromConsent('token-app-1')

    expect(result).toEqual({ ok: true })
  })

  it('calls submitVerificationForAutomation with the verification id', async () => {
    const { startHostedVerificationFromConsent } = await import(
      '../../../../app/provider/verify/[token]/actions'
    )

    await startHostedVerificationFromConsent('token-app-1')

    expect(mockSubmitAutomation).toHaveBeenCalledWith(
      'ver-app-1',
      mockDb,
      expect.objectContaining({ existingToken: 'token-app-1' }),
    )
  })

  it('does NOT attempt db.provider.update or db.provider.findUniqueOrThrow', async () => {
    const { startHostedVerificationFromConsent } = await import(
      '../../../../app/provider/verify/[token]/actions'
    )

    await startHostedVerificationFromConsent('token-app-1')

    expect(mockDb.provider.update).not.toHaveBeenCalled()
    expect(mockDb.provider.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('passes undefined (not null) as actorId in every transitionIdentityVerification call', async () => {
    const { startHostedVerificationFromConsent } = await import(
      '../../../../app/provider/verify/[token]/actions'
    )

    await startHostedVerificationFromConsent('token-app-1')

    for (const call of mockTransition.mock.calls) {
      const arg = call[0] as { actorId?: unknown }
      expect(arg.actorId).toBeUndefined()
    }
  })

  it('is a no-op when the verification is already past SUBMITTED', async () => {
    mockResolveToken.mockResolvedValue({
      ...NULL_PROVIDER_VERIFICATION,
      status: 'PROCESSING',
    })

    const { startHostedVerificationFromConsent } = await import(
      '../../../../app/provider/verify/[token]/actions'
    )

    const result = await startHostedVerificationFromConsent('token-app-1')

    expect(result).toEqual({ ok: true, alreadyAdvanced: true })
    expect(mockSubmitAutomation).not.toHaveBeenCalled()
    expect(mockDb.provider.update).not.toHaveBeenCalled()
  })
})
