import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockEstimateDiditCost: vi.fn(),
  mockGetDiditConfig: vi.fn(),
  mockGetDiditWorkflowId: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockIssueVerificationLink: vi.fn(),
  mockApplyVendorVerdict: vi.fn(),
  mockDb: {
    providerIdentityVerification: {
      findUnique: vi.fn(),
    },
    providerVerificationEvent: {
      create: vi.fn(),
    },
  },
  mockPersistDiditDecision: vi.fn(),
  mockRedirect: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockRequireRole: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRefreshDiditSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.mockRevalidatePath,
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.mockRedirect,
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: mocks.mockRequireAdmin,
  requireRole: mocks.mockRequireRole,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mocks.mockIsEnabled,
}))

vi.mock('@/lib/commercial/didit-pricing', () => ({
  estimateDiditCost: mocks.mockEstimateDiditCost,
}))

vi.mock('@/lib/crud-action', () => ({
  crudAction: mocks.mockCrudAction,
}))

vi.mock('@/lib/db', () => ({
  db: mocks.mockDb,
}))

vi.mock('@/lib/identity-verification/crypto', () => ({
  decryptIdentifier: vi.fn(),
}))

vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: mocks.mockIssueVerificationLink,
}))

vi.mock('@/lib/identity-verification/orchestrator', () => ({
  applyVendorVerdict: mocks.mockApplyVendorVerdict,
  submitVerificationForAutomation: vi.fn(),
  transitionIdentityVerification: vi.fn(),
}))

vi.mock('@/lib/identity-verification/vendors/didit/config', () => ({
  getDiditConfig: mocks.mockGetDiditConfig,
  getDiditWorkflowId: mocks.mockGetDiditWorkflowId,
}))

vi.mock('@/lib/identity-verification/vendors/didit/decision', () => ({
  refreshDiditSession: mocks.mockRefreshDiditSession,
}))

vi.mock('@/lib/identity-verification/vendors/didit/persist', () => ({
  persistDiditDecision: mocks.mockPersistDiditDecision,
}))

vi.mock('@/lib/whatsapp', () => ({
  sendText: vi.fn(),
}))

import {
  issueDiditOnboardingLinkAction,
  refreshDiditSessionFormAction,
  refreshDiditSessionAction,
} from '@/app/(admin)/admin/verifications/actions'

describe('Didit verification admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockRequireAdmin.mockResolvedValue({ id: 'admin-session', adminRole: 'TRUST', adminUserId: 'admin-user' })
    mocks.mockRequireRole.mockResolvedValue({ id: 'admin-session', adminRole: 'TRUST', adminUserId: 'admin-user' })
    mocks.mockIsEnabled.mockResolvedValue(true)
    mocks.mockGetDiditConfig.mockReturnValue({
      enabled: true,
      baseUrl: 'https://verification.didit.me',
      apiKey: 'sk_test',
      webhookSecrets: ['secret'],
      workflowIds: { basic: 'wf-basic', authoritative: 'wf-auth' },
      sessionExpiryHours: 168,
    })
    mocks.mockGetDiditWorkflowId.mockReturnValue('wf-auth')
    mocks.mockEstimateDiditCost.mockReturnValue({ centsUsd: 348, lineItems: [] })
    mocks.mockIssueVerificationLink.mockResolvedValue({
      verificationId: 'ver-1',
      verificationUrl: 'https://plug.test/provider/verify/token',
      expiresAt: new Date('2026-05-29T12:00:00.000Z'),
    })
    mocks.mockCrudAction.mockResolvedValue({ ok: true, data: { id: 'ver-1' } })
    mocks.mockApplyVendorVerdict.mockResolvedValue({ verificationId: 'ver-1', status: 'PASSED' })
    mocks.mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      status: 'PROCESSING',
      decision: null,
      sourceCheckProvider: 'didit',
      vendorReference: 'didit-pre:placeholder',
      livenessSessionReference: 'sess-1',
      vendorWorkflowId: 'wf-auth',
    })
    mocks.mockDb.providerVerificationEvent.create.mockResolvedValue({ id: 'event-1' })
    mocks.mockRefreshDiditSession.mockResolvedValue({
      raw: { session_id: 'sess-1', status: 'Approved' },
      normalized: {
        result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
        unknownStatus: null,
      },
    })
    mocks.mockPersistDiditDecision.mockResolvedValue({
      verificationId: 'ver-1',
      fieldsStamped: true,
      payloadRedacted: true,
      documentsStored: [],
      documentsSkipped: [],
      documentsFailed: [],
    })
  })

  it('does not mint a verification link when the admin verifications flag is disabled', async () => {
    mocks.mockIsEnabled.mockResolvedValue(false)

    const result = await issueDiditOnboardingLinkAction({ providerId: 'prov-1' })

    expect(result).toEqual({ ok: false, error: 'feature_disabled' })
    expect(mocks.mockIssueVerificationLink).not.toHaveBeenCalled()
    expect(mocks.mockCrudAction).not.toHaveBeenCalled()
  })

  it('fetches non-terminal Didit decisions outside crudAction, applies verdict inside it, then persists after success', async () => {
    const tx = { providerIdentityVerification: { update: vi.fn() } }
    mocks.mockCrudAction.mockImplementationOnce(async (options) => {
      expect(mocks.mockRefreshDiditSession).toHaveBeenCalledBefore(mocks.mockCrudAction)
      const data = await options.run(options.input, tx)
      return { ok: true, data }
    })
    mocks.mockDb.providerIdentityVerification.findUnique
      .mockResolvedValueOnce({
        id: 'ver-1',
        status: 'PROCESSING',
        decision: null,
        sourceCheckProvider: 'didit',
        vendorReference: 'didit-pre:placeholder',
        livenessSessionReference: 'sess-1',
        vendorWorkflowId: 'wf-auth',
      })
      .mockResolvedValueOnce({ id: 'ver-1', status: 'PASSED', decision: 'PASS' })

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: true, status: 'PASSED', decision: 'PASS' })
    expect(mocks.mockRefreshDiditSession).toHaveBeenCalledWith('sess-1', {
      storedVendorWorkflowId: 'wf-auth',
    })
    expect(mocks.mockApplyVendorVerdict).toHaveBeenCalledWith(
      'ver-1',
      { decision: 'PASS', confidence: 0.99, livenessVerified: true },
      'webhook',
      tx,
    )
    expect(mocks.mockPersistDiditDecision).toHaveBeenCalledWith(
      'ver-1',
      { session_id: 'sess-1', status: 'Approved' },
      { source: 'admin_refresh' },
    )
    expect(mocks.mockPersistDiditDecision).toHaveBeenCalledAfter(mocks.mockCrudAction)
  })

  it('does not call Didit when the admin verifications flag is disabled', async () => {
    mocks.mockIsEnabled.mockResolvedValue(false)

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: false, error: 'feature_disabled' })
    expect(mocks.mockDb.providerIdentityVerification.findUnique).not.toHaveBeenCalled()
    expect(mocks.mockRefreshDiditSession).not.toHaveBeenCalled()
    expect(mocks.mockCrudAction).not.toHaveBeenCalled()
    expect(mocks.mockPersistDiditDecision).not.toHaveBeenCalled()
  })

  it('fetches and persists already-terminal Didit rows but skips applyVendorVerdict', async () => {
    mocks.mockCrudAction.mockImplementationOnce(async (options) => {
      const data = await options.run(options.input, {})
      return { ok: true, data }
    })
    mocks.mockDb.providerIdentityVerification.findUnique
      .mockResolvedValueOnce({
        id: 'ver-1',
        status: 'PASSED',
        decision: 'PASS',
        sourceCheckProvider: 'didit',
        vendorReference: 'sess-terminal',
        vendorWorkflowId: 'wf-auth',
      })
      .mockResolvedValueOnce({ id: 'ver-1', status: 'PASSED', decision: 'PASS' })
    mocks.mockRefreshDiditSession.mockResolvedValueOnce({
      raw: { session_id: 'sess-terminal', status: 'Approved' },
      normalized: {
        result: { decision: 'PASS', confidence: 0.99, livenessVerified: true },
        unknownStatus: null,
      },
    })

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: true, status: 'PASSED', decision: 'PASS' })
    expect(mocks.mockRefreshDiditSession).toHaveBeenCalledWith('sess-terminal', {
      storedVendorWorkflowId: 'wf-auth',
    })
    expect(mocks.mockApplyVendorVerdict).not.toHaveBeenCalled()
    expect(mocks.mockPersistDiditDecision).toHaveBeenCalledWith(
      'ver-1',
      { session_id: 'sess-terminal', status: 'Approved' },
      { source: 'admin_refresh' },
    )
  })

  it('skips admin Didit persistence when the persist_documents flag is disabled', async () => {
    // Honour the operator persistence/backfill control: when
    // provider.identity.vendor.didit.persist_documents is OFF, the admin
    // refresh path must not download/store documents or redacted payloads,
    // matching the webhook gate. The verdict still applies inside crudAction.
    mocks.mockIsEnabled.mockImplementation(async (key: string) => key === 'admin.crud.verifications')
    mocks.mockCrudAction.mockImplementationOnce(async (options) => ({
      ok: true,
      data: await options.run(options.input, {}),
    }))
    mocks.mockDb.providerIdentityVerification.findUnique
      .mockResolvedValueOnce({
        id: 'ver-1',
        status: 'PASSED',
        decision: 'PASS',
        sourceCheckProvider: 'didit',
        vendorReference: 'sess-flag-off',
        vendorWorkflowId: 'wf-auth',
      })
      .mockResolvedValueOnce({ id: 'ver-1', status: 'PASSED', decision: 'PASS' })

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: true, status: 'PASSED', decision: 'PASS' })
    expect(mocks.mockPersistDiditDecision).not.toHaveBeenCalled()
  })

  it('runs admin Didit persistence when the persist_documents flag is enabled', async () => {
    mocks.mockIsEnabled.mockResolvedValue(true)
    mocks.mockCrudAction.mockImplementationOnce(async (options) => ({
      ok: true,
      data: await options.run(options.input, {}),
    }))
    mocks.mockDb.providerIdentityVerification.findUnique
      .mockResolvedValueOnce({
        id: 'ver-1',
        status: 'PASSED',
        decision: 'PASS',
        sourceCheckProvider: 'didit',
        vendorReference: 'sess-flag-on',
        vendorWorkflowId: 'wf-auth',
      })
      .mockResolvedValueOnce({ id: 'ver-1', status: 'PASSED', decision: 'PASS' })

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: true, status: 'PASSED', decision: 'PASS' })
    expect(mocks.mockPersistDiditDecision).toHaveBeenCalled()
  })

  it('logs persistence failure and still returns the post-apply DB row status and decision', async () => {
    mocks.mockCrudAction.mockImplementationOnce(async (options) => ({
      ok: true,
      data: await options.run(options.input, {}),
    }))
    mocks.mockDb.providerIdentityVerification.findUnique
      .mockResolvedValueOnce({
        id: 'ver-1',
        status: 'PASSED',
        decision: 'PASS',
        sourceCheckProvider: 'didit',
        vendorReference: 'sess-persist-fail',
        vendorWorkflowId: 'wf-auth',
      })
      .mockResolvedValueOnce({ id: 'ver-1', status: 'PASSED', decision: 'PASS' })
    mocks.mockPersistDiditDecision.mockRejectedValueOnce(new Error('persist failed'))

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: true, status: 'PASSED', decision: 'PASS' })
    expect(mocks.mockDb.providerVerificationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        fromStatus: 'PASSED',
        toStatus: 'PASSED',
        reasonCode: 'DIDIT_PERSIST_FAILED',
        metadata: expect.objectContaining({
          source: 'admin_refresh',
          error: 'persist failed',
          vendorReference: 'sess-persist-fail',
        }),
      }),
    })
  })

  it('returns a structured failure when the verification is missing', async () => {
    mocks.mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce(null)

    const result = await refreshDiditSessionAction({ verificationId: 'missing-verification' })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(mocks.mockRefreshDiditSession).not.toHaveBeenCalled()
    expect(mocks.mockCrudAction).not.toHaveBeenCalled()
  })

  it('returns a structured failure when the verification is not Didit-sourced', async () => {
    mocks.mockDb.providerIdentityVerification.findUnique.mockResolvedValueOnce({
      id: 'ver-1',
      status: 'PROCESSING',
      decision: null,
      sourceCheckProvider: 'smile_id',
      vendorReference: 'smile-job-1',
      livenessSessionReference: null,
      vendorWorkflowId: null,
    })

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: false, error: 'not_didit' })
    expect(mocks.mockRefreshDiditSession).not.toHaveBeenCalled()
    expect(mocks.mockCrudAction).not.toHaveBeenCalled()
  })

  it('returns a structured failure and form redirect when no real Didit session reference exists', async () => {
    mocks.mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      status: 'PROCESSING',
      decision: null,
      sourceCheckProvider: 'didit',
      vendorReference: 'didit-pre:placeholder',
      livenessSessionReference: null,
      vendorWorkflowId: null,
    })

    const result = await refreshDiditSessionAction({ verificationId: 'ver-1' })

    expect(result).toEqual({ ok: false, error: 'no_didit_session' })
    expect(mocks.mockRefreshDiditSession).not.toHaveBeenCalled()
    expect(mocks.mockCrudAction).not.toHaveBeenCalled()

    const formData = new FormData()
    formData.set('verificationId', 'ver-1')
    await refreshDiditSessionFormAction(formData)

    expect(mocks.mockRedirect).toHaveBeenCalledWith('/admin/verifications/ver-1?message=didit-refresh-failed-no-session')
  })
})
