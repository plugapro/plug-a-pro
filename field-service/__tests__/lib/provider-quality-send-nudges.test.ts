// sendNudges in lib/provider-quality/orchestrator.ts has a bug for the
// provider_kyc_nudge template: the template's URL button expects a signed
// {{1}} token (see lib/messaging-templates.ts:259 — "button (url, index 0):
// {{1}} signed verification token suffix appended to /provider/verify/") but
// sendNudges only passes body parameters via sendTemplate. The send would
// fail at Meta with a parameter-mismatch error the moment admin.quality.uplift
// is flipped on.
//
// Fix: when the planned template is provider_kyc_nudge, mint a signed link via
// issueProviderIdentityVerificationLink (mirroring lib/kyc-drive/nudge.ts) and
// call sendProviderKycNudge with the signed URL + deadline. These tests pin
// that behavior.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockIsEnabled,
  mockLoadProviderQualityRows,
  mockMessageEventFindMany,
  mockSendTemplate,
  mockSendProviderKycNudge,
  mockIssueProviderIdentityVerificationLink,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockLoadProviderQualityRows: vi.fn(),
  mockMessageEventFindMany: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockSendProviderKycNudge: vi.fn(),
  mockIssueProviderIdentityVerificationLink: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    messageEvent: { findMany: mockMessageEventFindMany },
  },
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

vi.mock('@/lib/provider-quality/queries', () => ({
  loadProviderQualityRows: mockLoadProviderQualityRows,
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: mockSendTemplate,
  sendProviderKycNudge: mockSendProviderKycNudge,
}))

vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: mockIssueProviderIdentityVerificationLink,
}))

import { sendNudges } from '@/lib/provider-quality/orchestrator'

// A row whose snapshot has only KYC missing — so the planner picks the
// single-dimension provider_kyc_nudge template, exercising the bug path.
function kycMissingRow(overrides: { id?: string; phone?: string | null; name?: string } = {}) {
  return {
    provider: {
      id: overrides.id ?? 'prov-kyc-1',
      name: overrides.name ?? 'Kyc Missing Provider',
      phone: overrides.phone ?? '+27800000001',
      active: true,
    },
    snapshot: {
      providerId: overrides.id ?? 'prov-kyc-1',
      isQualityReady: false,
      hasHighRiskSkill: false,
      missingItems: ['kyc'],
      dimensions: {
        kyc: 'MISSING',
        profile_photo: 'PRESENT',
        portfolio_evidence: 'PRESENT',
        high_risk_cert: 'NOT_APPLICABLE',
      },
      recommendedNudge: 'kyc',
    },
  }
}

const ACTOR = { actorId: 'admin-1', actorRole: 'ADMIN' as const }

beforeEach(() => {
  mockIsEnabled.mockReset().mockResolvedValue(true)
  mockLoadProviderQualityRows.mockReset().mockResolvedValue([])
  mockMessageEventFindMany.mockReset().mockResolvedValue([])
  mockSendTemplate.mockReset().mockResolvedValue('msg-id-1')
  mockSendProviderKycNudge.mockReset().mockResolvedValue('msg-id-1')
  mockIssueProviderIdentityVerificationLink.mockReset().mockResolvedValue({
    verificationId: 'ver-1',
    verificationUrl: 'https://app.test/provider/verify/signed-token-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    reused: false,
    status: 'NOT_STARTED',
  })
  process.env.KYC_DRIVE_NUDGE_DEADLINE = '31 July 2026'
})

describe('sendNudges — provider_kyc_nudge uses signed verification link', () => {
  it('calls issueProviderIdentityVerificationLink for the planned providerId', async () => {
    mockLoadProviderQualityRows.mockResolvedValue([kycMissingRow()])

    await sendNudges({ providerIds: ['prov-kyc-1'], ...ACTOR })

    expect(mockIssueProviderIdentityVerificationLink).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'prov-kyc-1', channel: 'WHATSAPP' }),
    )
  })

  it('routes KYC sends through sendProviderKycNudge with the signed URL + deadline (not bare sendTemplate)', async () => {
    mockLoadProviderQualityRows.mockResolvedValue([kycMissingRow()])

    const result = await sendNudges({ providerIds: ['prov-kyc-1'], ...ACTOR })

    expect(mockSendProviderKycNudge).toHaveBeenCalledTimes(1)
    const call = mockSendProviderKycNudge.mock.calls[0][0]
    expect(call.providerPhone).toBe('+27800000001')
    expect(call.providerFirstName).toBe('Kyc')
    expect(call.deadline).toBe('31 July 2026')
    expect(call.verificationUrl).toBe('https://app.test/provider/verify/signed-token-1')
    // Critical: the bare sendTemplate path must NOT be used for KYC — that's
    // what was causing the Meta parameter-mismatch failure.
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(result.sentCount).toBe(1)
    expect(result.failedCount).toBe(0)
  })

  it('fails with NO_VERIFICATION_URL when the link issuer returns null URL', async () => {
    mockLoadProviderQualityRows.mockResolvedValue([kycMissingRow()])
    mockIssueProviderIdentityVerificationLink.mockResolvedValue({
      verificationId: 'ver-1',
      verificationUrl: null,
      expiresAt: new Date(),
      reused: false,
      status: 'NOT_STARTED',
    })

    const result = await sendNudges({ providerIds: ['prov-kyc-1'], ...ACTOR })

    expect(mockSendProviderKycNudge).not.toHaveBeenCalled()
    expect(result.sentCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(result.failures[0]).toEqual(
      expect.objectContaining({ providerId: 'prov-kyc-1', reason: 'NO_VERIFICATION_URL' }),
    )
  })

  it('fails with MISSING_DEADLINE when KYC_DRIVE_NUDGE_DEADLINE env is unset', async () => {
    delete process.env.KYC_DRIVE_NUDGE_DEADLINE
    mockLoadProviderQualityRows.mockResolvedValue([kycMissingRow()])

    const result = await sendNudges({ providerIds: ['prov-kyc-1'], ...ACTOR })

    expect(mockSendProviderKycNudge).not.toHaveBeenCalled()
    // Deadline must be checked BEFORE the link is minted — minting writes
    // a token to the DB and would be wasted work otherwise.
    expect(mockIssueProviderIdentityVerificationLink).not.toHaveBeenCalled()
    expect(result.failures[0]).toEqual(
      expect.objectContaining({ providerId: 'prov-kyc-1', reason: 'MISSING_DEADLINE' }),
    )
  })

  it('propagates the link issuer error message when token minting throws', async () => {
    mockLoadProviderQualityRows.mockResolvedValue([kycMissingRow()])
    mockIssueProviderIdentityVerificationLink.mockRejectedValue(
      new Error('PROVIDER_NOT_FOUND: provider deleted between preview and send'),
    )

    const result = await sendNudges({ providerIds: ['prov-kyc-1'], ...ACTOR })

    expect(mockSendProviderKycNudge).not.toHaveBeenCalled()
    expect(result.failedCount).toBe(1)
    expect(result.failures[0].reason).toMatch(/PROVIDER_NOT_FOUND/)
  })
})

describe('sendNudges — non-KYC templates unchanged (regression)', () => {
  it('still uses sendTemplate (not sendProviderKycNudge) for profile_photo', async () => {
    mockLoadProviderQualityRows.mockResolvedValue([
      {
        provider: {
          id: 'prov-photo-1',
          name: 'Photo Missing Provider',
          phone: '+27800000002',
          active: true,
        },
        snapshot: {
          providerId: 'prov-photo-1',
          isQualityReady: false,
          hasHighRiskSkill: false,
          missingItems: ['profile_photo'],
          dimensions: {
            kyc: 'PRESENT',
            profile_photo: 'MISSING',
            portfolio_evidence: 'PRESENT',
            high_risk_cert: 'NOT_APPLICABLE',
          },
          recommendedNudge: 'profile_photo',
        },
      },
    ])

    const result = await sendNudges({ providerIds: ['prov-photo-1'], ...ACTOR })

    expect(mockSendTemplate).toHaveBeenCalledTimes(1)
    expect(mockSendTemplate.mock.calls[0][0].template).toBe('provider_profile_photo_nudge')
    expect(mockSendProviderKycNudge).not.toHaveBeenCalled()
    expect(mockIssueProviderIdentityVerificationLink).not.toHaveBeenCalled()
    expect(result.sentCount).toBe(1)
  })
})

describe('sendNudges — feature flag', () => {
  it('returns FEATURE_DISABLED for every provider when admin.quality.uplift is OFF', async () => {
    mockIsEnabled.mockResolvedValue(false)

    const result = await sendNudges({ providerIds: ['prov-kyc-1', 'prov-kyc-2'], ...ACTOR })

    expect(result.sentCount).toBe(0)
    expect(result.failedCount).toBe(2)
    expect(result.failures.every((f) => f.reason === 'FEATURE_DISABLED')).toBe(true)
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockSendProviderKycNudge).not.toHaveBeenCalled()
    expect(mockIssueProviderIdentityVerificationLink).not.toHaveBeenCalled()
  })
})
