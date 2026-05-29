import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockEstimateDiditCost: vi.fn(),
  mockGetDiditConfig: vi.fn(),
  mockGetDiditWorkflowId: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockIssueVerificationLink: vi.fn(),
  mockRedirect: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockRequireRole: vi.fn(),
  mockRevalidatePath: vi.fn(),
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
  db: {},
}))

vi.mock('@/lib/identity-verification/crypto', () => ({
  decryptIdentifier: vi.fn(),
}))

vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: mocks.mockIssueVerificationLink,
}))

vi.mock('@/lib/identity-verification/orchestrator', () => ({
  applyVendorVerdict: vi.fn(),
  submitVerificationForAutomation: vi.fn(),
  transitionIdentityVerification: vi.fn(),
}))

vi.mock('@/lib/identity-verification/vendors/didit/config', () => ({
  getDiditConfig: mocks.mockGetDiditConfig,
  getDiditWorkflowId: mocks.mockGetDiditWorkflowId,
}))

vi.mock('@/lib/identity-verification/vendors/didit/decision', () => ({
  refreshDiditSession: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendText: vi.fn(),
}))

import { issueDiditOnboardingLinkAction } from '@/app/(admin)/admin/verifications/actions'

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
  })

  it('does not mint a verification link when the admin verifications flag is disabled', async () => {
    mocks.mockIsEnabled.mockResolvedValue(false)

    const result = await issueDiditOnboardingLinkAction({ providerId: 'prov-1' })

    expect(result).toEqual({ ok: false, error: 'feature_disabled' })
    expect(mocks.mockIssueVerificationLink).not.toHaveBeenCalled()
    expect(mocks.mockCrudAction).not.toHaveBeenCalled()
  })
})
