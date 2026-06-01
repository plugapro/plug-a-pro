import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCrudAction, mockTransition, mockRequireAdmin, mockDb, mockSendText, mockIsEnabled } = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockTransition: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockSendText: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockDb: {
    providerIdentityVerification: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    providerVerificationReview: {
      create: vi.fn(),
    },
    providerSensitiveDataAccessLog: {
      create: vi.fn(),
    },
    messageEvent: {
      create: vi.fn(),
    },
  },
}))

vi.mock('../../lib/crud-action', () => ({ crudAction: mockCrudAction }))
vi.mock('../../lib/auth', () => ({ requireAdmin: mockRequireAdmin }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('../../lib/identity-verification/orchestrator', () => ({
  transitionIdentityVerification: mockTransition,
}))
vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/whatsapp', () => ({ sendText: mockSendText }))
vi.mock('@/lib/whatsapp', () => ({ sendText: mockSendText }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
  redirect: vi.fn(() => {
    throw new Error('redirect')
  }),
}))

describe('admin identity verification actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ id: 'supabase-admin-1', adminUserId: 'admin-1', adminRole: 'TRUST' })
    mockIsEnabled.mockResolvedValue(true)
    mockTransition.mockResolvedValue({ id: 'ver-1', status: 'PASSED' })
    mockSendText.mockResolvedValue('wamid.identity-approved')
    mockDb.providerVerificationReview.create.mockResolvedValue({ id: 'review-1' })
    mockDb.providerSensitiveDataAccessLog.create.mockResolvedValue({ id: 'access-log-1' })
    mockDb.messageEvent.create.mockResolvedValue({ id: 'message-1' })
    mockDb.providerIdentityVerification.findMany.mockResolvedValue([])
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      identityBasis: 'SA_ID',
      channel: 'PWA',
      assuranceLevel: 'MEDIUM',
      decision: null,
      identifierLast4: '9087',
      identifierEncrypted: null,
      issuingCountry: 'South Africa',
      nationality: 'South Africa',
      documentExpiryDate: null,
      failureReasonCode: null,
      riskFlags: { nameMismatch: true, documentExpired: false },
      status: 'NEEDS_MANUAL_REVIEW',
      createdAt: new Date('2026-05-25T08:00:00.000Z'),
      provider: {
        id: 'provider-1',
        name: 'Sarah Provider',
        phone: '+27820000000',
        email: 'sarah@example.test',
        kycStatus: 'SUBMITTED',
        status: 'ACTIVE',
      },
      providerApplication: null,
      documents: [],
      events: [],
      webhookEvents: [],
      reviews: [],
    })
    mockCrudAction.mockImplementation(async (opts) => {
      const tx = {
        providerIdentityVerification: mockDb.providerIdentityVerification,
        providerVerificationReview: mockDb.providerVerificationReview,
        providerSensitiveDataAccessLog: mockDb.providerSensitiveDataAccessLog,
      }
      return {
        ok: true,
        data: await opts.run(opts.input, tx),
      }
    })
  })

  it('approves verification through crudAction with TRUST role and audit flag', async () => {
    const { approveIdentityVerificationAction } = await import('../../app/(admin)/admin/verifications/actions')

    await expect(
      approveIdentityVerificationAction({ verificationId: 'ver-1', notes: 'Document and selfie match.' }),
    ).resolves.toEqual({ ok: true, notification: 'sent' })

    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'ProviderIdentityVerification',
      entityId: 'ver-1',
      action: 'provider_identity_verification.approve',
      requiredRole: ['TRUST'],
      requiredFlag: 'admin.crud.verifications',
    }))
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: 'ver-1',
        toStatus: 'PASSED',
        decision: 'PASS',
      }),
      expect.anything(),
    )
    expect(mockDb.providerVerificationReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        decision: 'PASS',
        notes: 'Document and selfie match.',
      }),
    })
    expect(mockSendText).toHaveBeenCalledWith({
      to: '+27820000000',
      text: 'Your identity verification is complete. Your profile has been updated.',
      templateName: 'identity_verification_approved',
      metadata: {
        verificationId: 'ver-1',
        providerId: 'provider-1',
        source: 'admin_identity_verification_approval',
      },
    })
  })

  it('keeps approval successful and logs a failed message event when approval notification fails', async () => {
    mockSendText.mockRejectedValueOnce(new Error('WhatsApp send failed'))
    const { approveIdentityVerificationAction } = await import('../../app/(admin)/admin/verifications/actions')

    await expect(
      approveIdentityVerificationAction({ verificationId: 'ver-1', notes: 'Document and selfie match.' }),
    ).resolves.toEqual({ ok: true, notification: 'failed' })

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: 'identity_verification_approved',
        to: '+27820000000',
        status: 'FAILED',
        failureReason: 'WhatsApp send failed',
        metadata: expect.objectContaining({
          verificationId: 'ver-1',
          providerId: 'provider-1',
          source: 'admin_identity_verification_approval',
        }),
      }),
    })
  })

  it('requests retry instead of approving when evidence is incomplete', async () => {
    const { requestIdentityVerificationRetryAction } = await import('../../app/(admin)/admin/verifications/actions')

    await requestIdentityVerificationRetryAction({ verificationId: 'ver-1', notes: 'Selfie is blurry.' })

    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'provider_identity_verification.request_retry',
      requiredRole: ['TRUST'],
    }))
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: 'ver-1',
        toStatus: 'RETRY_REQUIRED',
        decision: 'RETRY_REQUIRED',
        reasonCode: 'ADMIN_REQUESTED_RETRY',
      }),
      expect.anything(),
    )
  })

  it('renders risk flags on the admin verification detail page', async () => {
    const Page = (await import('../../app/(admin)/admin/verifications/[id]/page')).default

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ id: 'ver-1' }),
        searchParams: Promise.resolve({}),
      }),
    )

    expect(html).toContain('Risk flags')
    expect(html).toContain('nameMismatch')
    expect(html).toContain('true')
  })

  it('renders a warning when approval succeeds but provider notification fails', async () => {
    const Page = (await import('../../app/(admin)/admin/verifications/[id]/page')).default

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ id: 'ver-1' }),
        searchParams: Promise.resolve({ message: 'approved-notification-failed' }),
      }),
    )

    expect(html).toContain('Approval recorded, but the provider notification failed.')
    expect(html).toContain('Check Admin Messages')
  })

  it('renders a warning when approval succeeds but provider notification is skipped', async () => {
    const Page = (await import('../../app/(admin)/admin/verifications/[id]/page')).default

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ id: 'ver-1' }),
        searchParams: Promise.resolve({ message: 'approved-notification-skipped' }),
      }),
    )

    expect(html).toContain('Approval recorded, but no provider phone was available')
  })

  it('defaults the identity verification list to manual-review work', async () => {
    const Page = (await import('../../app/(admin)/admin/verifications/page')).default

    await Page({
      searchParams: Promise.resolve({}),
    })

    expect(mockDb.providerIdentityVerification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'NEEDS_MANUAL_REVIEW',
      }),
    }))
  })

  it('reveals an encrypted identifier through audited crudAction only when one exists', async () => {
    const { encryptIdentifier } = await import('../../lib/identity-verification/crypto')
    vi.stubEnv('IDENTITY_ENC_KEY', Buffer.from('12345678901234567890123456789012').toString('base64'))
    mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce({
      id: 'ver-1',
      identifierEncrypted: encryptIdentifier('8001015009087'),
    })

    const { revealIdentityIdentifierAction } = await import('../../app/(admin)/admin/verifications/actions')
    const result = await revealIdentityIdentifierAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: true, identifier: '8001015009087' })
    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'provider_identity_verification.reveal_identifier',
      requiredRole: ['TRUST'],
      requiredFlag: 'admin.crud.verifications',
    }))
    expect(mockDb.providerSensitiveDataAccessLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        actorId: 'admin-1',
        actorRole: 'TRUST',
        accessType: 'REVEAL_IDENTIFIER',
      }),
    })
  })
})
