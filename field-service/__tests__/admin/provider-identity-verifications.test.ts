import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCrudAction, mockTransition, mockRequireAdmin, mockDb } = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockTransition: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockDb: {
    providerVerificationReview: {
      create: vi.fn(),
    },
  },
}))

vi.mock('../../lib/crud-action', () => ({ crudAction: mockCrudAction }))
vi.mock('../../lib/auth', () => ({ requireAdmin: mockRequireAdmin }))
vi.mock('../../lib/identity-verification/orchestrator', () => ({
  transitionIdentityVerification: mockTransition,
}))
vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('admin identity verification actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ id: 'supabase-admin-1', adminUserId: 'admin-1', adminRole: 'TRUST' })
    mockTransition.mockResolvedValue({ id: 'ver-1', status: 'PASSED' })
    mockDb.providerVerificationReview.create.mockResolvedValue({ id: 'review-1' })
    mockCrudAction.mockImplementation(async (opts) => {
      const tx = {
        providerVerificationReview: mockDb.providerVerificationReview,
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
    ).resolves.toEqual({ ok: true })

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
})
