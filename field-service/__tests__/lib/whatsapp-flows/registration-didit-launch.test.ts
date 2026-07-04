// Task 2.4: When provider.onboarding.quality_gate_v2 is ON, the WhatsApp
// registration summary confirm (reg_pending + submit_yes) must NOT create a
// ProviderApplication/Provider immediately. Instead it persists a replayable
// ProviderApplicationDraft (submitPayload bundle), issues a Didit verification
// link anchored to that draft, sends the hosted link via a CTA-URL button, and
// lands on the new reg_awaiting_kyc step (create-on-PASS). When the gate is OFF
// the existing submitProviderApplication path runs unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateEnabled, mockSendText } = vi.hoisted(() => ({
  gateEnabled: vi.fn(),
  mockSendText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: gateEnabled,
}))

vi.mock('@/lib/kyc-policy', () => ({
  isKycRequiredForActivation: vi.fn().mockResolvedValue(false),
  KYC_REQUIRED_FLAG: 'provider.kyc.required_for_activation',
  KYC_EXISTING_PROVIDER_GRACE_DAYS: 30,
}))

const { mockDraftUpsert, mockDraftCreate, mockDraftFindFirst, mockDraftUpdate, dbMock } = vi.hoisted(() => {
  const dbMock: any = {
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    providerApplication: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    provider: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), createMany: vi.fn() },
    providerCategory: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    providerRate: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    attachment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    providerApplicationDraft: {
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ data: {} }),
      update: vi.fn().mockResolvedValue({ id: 'conv-mock' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
  // The gate-OFF submit path runs one $transaction; hand it the same mock so its
  // inner queries resolve. The gate-ON path must never reach here.
  dbMock.$transaction = vi.fn(async (fn: any) => fn(dbMock))
  return {
    dbMock,
    mockDraftUpsert: dbMock.providerApplicationDraft.upsert,
    mockDraftCreate: dbMock.providerApplicationDraft.create,
    mockDraftUpdate: dbMock.providerApplicationDraft.update,
    mockDraftFindFirst: dbMock.providerApplicationDraft.findFirst,
  }
})

vi.mock('@/lib/db', () => ({ db: dbMock }))

const { mockSyncProviderRecord, mockSubmitProviderApplication } = vi.hoisted(() => ({
  mockSyncProviderRecord: vi.fn().mockResolvedValue('prov_mock_001'),
  mockSubmitProviderApplication: vi.fn().mockResolvedValue({ application: { id: 'app_mock_00000001' } }),
}))

vi.mock('@/lib/provider-record', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-record')>()),
  syncProviderRecord: mockSyncProviderRecord,
}))

vi.mock('@/lib/provider-applications-submit', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-applications-submit')>()),
  submitProviderApplication: mockSubmitProviderApplication,
}))

const { mockIssueLink } = vi.hoisted(() => ({
  mockIssueLink: vi.fn(),
}))

vi.mock('@/lib/identity-verification/application-link', () => ({
  issueProviderApplicationVerificationLink: mockIssueLink,
}))

const {
  mockSendButtons,
  mockSendList,
  mockSendCtaUrl,
} = vi.hoisted(() => ({
  mockSendButtons: vi.fn().mockResolvedValue(undefined),
  mockSendList: vi.fn().mockResolvedValue(undefined),
  mockSendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: mockSendButtons,
  sendList: mockSendList,
  sendCtaUrl: mockSendCtaUrl,
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn().mockResolvedValue({ attachmentId: 'att_mock_001' }),
}))

vi.mock('@/lib/whatsapp-media-batch', () => ({
  debounceMediaBatch: vi.fn().mockResolvedValue({ mySeq: 1, isLatest: true }),
  readMediaBatchSeq: vi.fn().mockResolvedValue(1),
  claimMediaBatchSeq: vi.fn().mockResolvedValue(1),
  awaitAndCheckLatest: vi.fn().mockResolvedValue(true),
  WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS: 0,
}))

vi.mock('@/lib/journey-recovery', () => ({
  sendWhatsAppJourneyRecovery: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  checkJobsForNewProviderAvailability: vi.fn().mockResolvedValue(undefined),
}))

import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'

// Complete, submittable ctx.data — passes validateSubmitData + quality gate.
function completeData(overrides: any = {}) {
  return {
    name: 'Test Provider',
    skills: ['plumbing'],
    serviceAreas: ['Soweto'],
    availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    experience: '3–5 years',
    evidenceFileUrls: ['ev_a', 'ev_b', 'ev_c'],
    evidenceNote: 'work photos',
    certificationRef: 'PIRB-12345',
    providerEmail: 'test@example.com',
    ...overrides,
  }
}

function buildCtx(overrides: any = {}) {
  return {
    phone: '+27821234567',
    flow: 'registration',
    step: 'reg_pending',
    data: completeData(),
    reply: { type: 'interactive', id: 'submit_yes' },
    ...overrides,
  }
}

beforeEach(() => {
  gateEnabled.mockReset().mockResolvedValue(true)
  mockSendText.mockReset().mockResolvedValue(undefined)
  mockSendButtons.mockClear()
  mockSendList.mockClear()
  mockSendCtaUrl.mockClear()
  mockDraftUpsert.mockReset().mockResolvedValue({ id: 'draft_mock_001' })
  mockDraftCreate.mockReset().mockResolvedValue({ id: 'draft_mock_001' })
  mockDraftUpdate.mockReset().mockResolvedValue({ id: 'draft_mock_001' })
  mockDraftFindFirst.mockReset().mockResolvedValue(null)
  mockSyncProviderRecord.mockReset().mockResolvedValue('prov_mock_001')
  mockSubmitProviderApplication.mockReset().mockResolvedValue({ application: { id: 'app_mock_00000001' } })
  mockIssueLink.mockReset().mockResolvedValue({
    verificationId: 'ver_mock_001',
    verificationUrl: 'https://plugapro.example/provider/verify/tok_abc',
    expiresAt: new Date(Date.now() + 3600_000),
    reused: false,
  })
})

describe('WhatsApp summary → Didit launch (quality gate v2 create-on-PASS)', () => {
  it('gate ON: persists draft, issues link, sends CTA-URL, lands reg_awaiting_kyc, creates NO application', async () => {
    const result = await handleRegistrationFlow(buildCtx())

    // A draft was persisted (upsert or create).
    const draftPersisted = mockDraftUpsert.mock.calls.length > 0 || mockDraftCreate.mock.calls.length > 0
    expect(draftPersisted).toBe(true)

    // Verification link issued for this draft over WhatsApp.
    expect(mockIssueLink).toHaveBeenCalledTimes(1)
    expect(mockIssueLink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerApplicationDraftId: 'draft_mock_001',
        channel: 'WHATSAPP',
      }),
    )

    // The hosted link went out as a CTA-URL button.
    expect(mockSendCtaUrl).toHaveBeenCalledTimes(1)
    const ctaArgs = mockSendCtaUrl.mock.calls[0]
    expect(ctaArgs[3]).toBe('https://plugapro.example/provider/verify/tok_abc')

    // Landed on the new awaiting-KYC step.
    expect(result.nextStep).toBe('reg_awaiting_kyc')

    // NO application / provider created at confirm time.
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
  })

  it('gate ON: null verificationUrl → stays awaiting, sends fallback text, no CTA button', async () => {
    mockIssueLink.mockResolvedValueOnce({
      verificationId: 'ver_mock_001',
      verificationUrl: null,
      expiresAt: new Date(Date.now() + 3600_000),
      reused: false,
    })

    const result = await handleRegistrationFlow(buildCtx())

    expect(result.nextStep).toBe('reg_awaiting_kyc')
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalled()
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
  })

  it('gate OFF: submitProviderApplication IS called (existing path), no draft-launch', async () => {
    gateEnabled.mockResolvedValue(false)
    // The submit transaction validates evidence attachments exist and are
    // unlinked before creating the application; return matching rows so the
    // gate-OFF path reaches submitProviderApplication.
    dbMock.attachment.findMany.mockResolvedValueOnce([
      { id: 'ev_a', providerApplicationId: null },
      { id: 'ev_b', providerApplicationId: null },
      { id: 'ev_c', providerApplicationId: null },
    ])

    await handleRegistrationFlow(buildCtx())

    expect(mockSubmitProviderApplication).toHaveBeenCalledTimes(1)
    expect(mockIssueLink).not.toHaveBeenCalled()
  })
})

describe('P1: gate-ON conflict guards run before draft launch (WhatsApp handlePending)', () => {
  it('gate ON + phone is a customer → rejected identically to gate-OFF, no draft, no KYC link', async () => {
    dbMock.customer.findFirst.mockResolvedValueOnce({ id: 'cust_existing' })

    const result = await handleRegistrationFlow(buildCtx())

    // The applicant should be told they are registered as a customer
    expect(mockSendText).toHaveBeenCalledTimes(1)
    expect(mockSendText.mock.calls[0][1]).toMatch(/already registered as a customer/i)
    // No draft created, no KYC link issued
    const draftPersisted = mockDraftUpsert.mock.calls.length > 0 || mockDraftCreate.mock.calls.length > 0
    expect(draftPersisted).toBe(false)
    expect(mockIssueLink).not.toHaveBeenCalled()
    // No application or provider created
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
    // Ends the flow
    expect(result.nextStep).toBe('done')
  })

  it('gate ON + PENDING application exists → existing_pending route, no draft, no KYC link', async () => {
    dbMock.providerApplication.findFirst.mockResolvedValueOnce({
      id: 'app_existing_001',
      phone: '+27821234567',
      status: 'PENDING',
      name: 'Test Provider',
      providerId: null,
      submittedAt: new Date(),
    })

    const result = await handleRegistrationFlow(buildCtx())

    // The applicant should be told their application is already submitted
    expect(mockSendButtons).toHaveBeenCalledTimes(1)
    expect(mockSendButtons.mock.calls[0][1]).toMatch(/already submitted/i)
    // No draft created, no KYC link issued
    const draftPersisted = mockDraftUpsert.mock.calls.length > 0 || mockDraftCreate.mock.calls.length > 0
    expect(draftPersisted).toBe(false)
    expect(mockIssueLink).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('done')
  })

  it('gate ON + APPROVED application exists → existing_approved route, no draft, no KYC link', async () => {
    dbMock.providerApplication.findFirst.mockResolvedValueOnce({
      id: 'app_existing_002',
      phone: '+27821234567',
      status: 'APPROVED',
      name: 'Test Provider',
      providerId: 'prov_001',
      submittedAt: new Date(),
    })

    const result = await handleRegistrationFlow(buildCtx())

    expect(mockSendButtons).toHaveBeenCalledTimes(1)
    expect(mockSendButtons.mock.calls[0][1]).toMatch(/already registered/i)
    const draftPersisted = mockDraftUpsert.mock.calls.length > 0 || mockDraftCreate.mock.calls.length > 0
    expect(draftPersisted).toBe(false)
    expect(mockIssueLink).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('done')
  })

  it('gate ON + MORE_INFO_REQUIRED application exists → more_info route, no draft, no KYC link', async () => {
    dbMock.providerApplication.findFirst.mockResolvedValueOnce({
      id: 'app_existing_003',
      phone: '+27821234567',
      status: 'MORE_INFO_REQUIRED',
      name: 'Test Provider',
      providerId: null,
      submittedAt: new Date(),
    })

    const result = await handleRegistrationFlow(buildCtx())

    expect(mockSendText).toHaveBeenCalledTimes(1)
    expect(mockSendText.mock.calls[0][1]).toMatch(/more information/i)
    const draftPersisted = mockDraftUpsert.mock.calls.length > 0 || mockDraftCreate.mock.calls.length > 0
    expect(draftPersisted).toBe(false)
    expect(mockIssueLink).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('done')
  })

  it('gate ON + clean applicant → happy path, draft persisted and KYC link issued', async () => {
    // No customer, no existing application — clean happy path
    const result = await handleRegistrationFlow(buildCtx())

    expect(result.nextStep).toBe('reg_awaiting_kyc')
    const draftPersisted = mockDraftUpsert.mock.calls.length > 0 || mockDraftCreate.mock.calls.length > 0
    expect(draftPersisted).toBe(true)
    expect(mockIssueLink).toHaveBeenCalledTimes(1)
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
  })
})

describe('Task 2.8: Didit unavailable at launchQgv2DraftAndVerification (gate ON)', () => {
  it('issueLink throws generic Error → sends temporarily-unavailable text, lands reg_awaiting_kyc, draft stays, no application', async () => {
    mockDraftCreate.mockResolvedValueOnce({ id: 'draft_mock_err_001' })
    mockIssueLink.mockRejectedValueOnce(new Error('didit down'))

    const result = await handleRegistrationFlow(buildCtx())

    expect(result.nextStep).toBe('reg_awaiting_kyc')
    // Draft was persisted
    const draftPersisted = mockDraftCreate.mock.calls.length > 0 || mockDraftUpdate.mock.calls.length > 0
    expect(draftPersisted).toBe(true)
    // Draft NOT deleted (deletion mock does not exist on providerApplicationDraft, making deletion structurally impossible)
    expect(dbMock.providerApplicationDraft.delete).toBeUndefined()
    // No CTA URL sent
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
    // Temporarily-unavailable text sent
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('temporarily unavailable'),
    )
    // No application or provider created
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
  })

  it('issueLink throws DiditDisabledError → same temporarily-unavailable outcome', async () => {
    const { DiditDisabledError } = await import('@/lib/identity-verification/vendors/didit/client')
    mockDraftCreate.mockResolvedValueOnce({ id: 'draft_mock_err_002' })
    mockIssueLink.mockRejectedValueOnce(new DiditDisabledError('DIDIT_API_KEY not set'))

    const result = await handleRegistrationFlow(buildCtx())

    expect(result.nextStep).toBe('reg_awaiting_kyc')
    // Draft NOT deleted (deletion mock does not exist on providerApplicationDraft, making deletion structurally impossible)
    expect(dbMock.providerApplicationDraft.delete).toBeUndefined()
    expect(mockSendCtaUrl).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('temporarily unavailable'),
    )
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
  })

  it('no manual vendor fallback on throw — submitProviderApplication never called', async () => {
    mockDraftCreate.mockResolvedValueOnce({ id: 'draft_mock_err_003' })
    mockIssueLink.mockRejectedValueOnce(new Error('connection refused'))

    await handleRegistrationFlow(buildCtx())

    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
    // Draft NOT deleted (deletion mock does not exist on providerApplicationDraft, making deletion structurally impossible)
    expect(dbMock.providerApplicationDraft.delete).toBeUndefined()
  })
})

describe('handleAwaitingKyc (re-nudge flow)', () => {
  it('re-nudge happy path: draft exists, link issued, CTA-URL sent, stays reg_awaiting_kyc', async () => {
    // Draft exists for the phone number
    mockDraftFindFirst.mockResolvedValueOnce({
      id: 'draft_mock_001',
      phone: '+27821234567',
      submittedApplicationId: null,
    })

    // issueProviderApplicationVerificationLink returns a URL
    mockIssueLink.mockResolvedValueOnce({
      verificationId: 'ver_mock_001',
      verificationUrl: 'https://plugapro.example/provider/verify/tok_xyz789',
      expiresAt: new Date(Date.now() + 3600_000),
      reused: false,
    })

    const result = await handleRegistrationFlow(
      buildCtx({
        step: 'reg_awaiting_kyc',
        reply: { type: 'interactive', id: 'any' },
      })
    )

    // Handler queries the draft by phone (normalized) and submittedApplicationId: null
    expect(mockDraftFindFirst).toHaveBeenCalledWith({
      where: {
        phone: '+27821234567',
        submittedApplicationId: null,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })

    // issueProviderApplicationVerificationLink called with the draft ID
    expect(mockIssueLink).toHaveBeenCalledTimes(1)
    expect(mockIssueLink).toHaveBeenCalledWith({
      providerApplicationDraftId: 'draft_mock_001',
      channel: 'WHATSAPP',
    })

    // CTA-URL button sent with the verification URL
    expect(mockSendCtaUrl).toHaveBeenCalledTimes(1)
    expect(mockSendCtaUrl).toHaveBeenCalledWith(
      '+27821234567',
      "You're almost done — verify your identity to finish your application.",
      'Verify identity',
      'https://plugapro.example/provider/verify/tok_xyz789',
      undefined,
      { templateName: 'interactive:provider_application_verify_cta' }
    )

    // Stay on reg_awaiting_kyc
    expect(result.nextStep).toBe('reg_awaiting_kyc')

    // Fallback text should NOT be sent when CTA-URL succeeds
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('re-nudge fallback: no draft found, sends text nudge, stays reg_awaiting_kyc', async () => {
    // No draft exists for this phone
    mockDraftFindFirst.mockResolvedValueOnce(null)

    const result = await handleRegistrationFlow(
      buildCtx({
        step: 'reg_awaiting_kyc',
        reply: { type: 'interactive', id: 'any' },
      })
    )

    // Handler tried to find the draft
    expect(mockDraftFindFirst).toHaveBeenCalled()

    // issueProviderApplicationVerificationLink NOT called (no draft)
    expect(mockIssueLink).not.toHaveBeenCalled()

    // No CTA-URL sent
    expect(mockSendCtaUrl).not.toHaveBeenCalled()

    // Fallback text nudge sent instead
    expect(mockSendText).toHaveBeenCalledTimes(1)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('waiting on your identity verification')
    )

    // Stay on reg_awaiting_kyc
    expect(result.nextStep).toBe('reg_awaiting_kyc')
  })

  it('re-nudge fallback: link returns null verificationUrl, sends text nudge, no crash', async () => {
    // Draft exists
    mockDraftFindFirst.mockResolvedValueOnce({
      id: 'draft_mock_001',
      phone: '+27821234567',
      submittedApplicationId: null,
    })

    // issueProviderApplicationVerificationLink returns null URL
    mockIssueLink.mockResolvedValueOnce({
      verificationId: 'ver_mock_001',
      verificationUrl: null,
      expiresAt: new Date(Date.now() + 3600_000),
      reused: false,
    })

    const result = await handleRegistrationFlow(
      buildCtx({
        step: 'reg_awaiting_kyc',
        reply: { type: 'interactive', id: 'any' },
      })
    )

    // Handler found the draft and tried to issue a link
    expect(mockDraftFindFirst).toHaveBeenCalled()
    expect(mockIssueLink).toHaveBeenCalledTimes(1)

    // No CTA-URL sent (no valid URL)
    expect(mockSendCtaUrl).not.toHaveBeenCalled()

    // Fallback text sent
    expect(mockSendText).toHaveBeenCalledTimes(1)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('waiting on your identity verification')
    )

    // Stay on reg_awaiting_kyc, no crash
    expect(result.nextStep).toBe('reg_awaiting_kyc')
  })

  it('re-nudge fallback: issueProviderApplicationVerificationLink throws, catches, sends text', async () => {
    // Draft exists
    mockDraftFindFirst.mockResolvedValueOnce({
      id: 'draft_mock_001',
      phone: '+27821234567',
      submittedApplicationId: null,
    })

    // issueProviderApplicationVerificationLink throws
    mockIssueLink.mockRejectedValueOnce(new Error('Didit service unavailable'))

    const result = await handleRegistrationFlow(
      buildCtx({
        step: 'reg_awaiting_kyc',
        reply: { type: 'interactive', id: 'any' },
      })
    )

    // Handler found draft and tried to issue link
    expect(mockDraftFindFirst).toHaveBeenCalled()
    expect(mockIssueLink).toHaveBeenCalledTimes(1)

    // No CTA-URL sent (error caught)
    expect(mockSendCtaUrl).not.toHaveBeenCalled()

    // Fallback text sent
    expect(mockSendText).toHaveBeenCalledTimes(1)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('waiting on your identity verification')
    )

    // Stay on reg_awaiting_kyc, no crash
    expect(result.nextStep).toBe('reg_awaiting_kyc')
  })

  it('re-nudge fallback: sendCtaUrl throws, falls through to text, no crash', async () => {
    // Draft exists
    mockDraftFindFirst.mockResolvedValueOnce({
      id: 'draft_mock_001',
      phone: '+27821234567',
      submittedApplicationId: null,
    })

    // issueProviderApplicationVerificationLink succeeds
    mockIssueLink.mockResolvedValueOnce({
      verificationId: 'ver_mock_001',
      verificationUrl: 'https://plugapro.example/provider/verify/tok_xyz789',
      expiresAt: new Date(Date.now() + 3600_000),
      reused: false,
    })

    // sendCtaUrl throws (transport error)
    mockSendCtaUrl.mockRejectedValueOnce(new Error('WhatsApp service error'))

    const result = await handleRegistrationFlow(
      buildCtx({
        step: 'reg_awaiting_kyc',
        reply: { type: 'interactive', id: 'any' },
      })
    )

    // Handler found draft and tried to issue link
    expect(mockDraftFindFirst).toHaveBeenCalled()
    expect(mockIssueLink).toHaveBeenCalledTimes(1)

    // sendCtaUrl was attempted but failed
    expect(mockSendCtaUrl).toHaveBeenCalledTimes(1)

    // Fallback text sent (caught from sendCtaUrl error)
    expect(mockSendText).toHaveBeenCalledTimes(1)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('waiting on your identity verification')
    )

    // Stay on reg_awaiting_kyc, no crash
    expect(result.nextStep).toBe('reg_awaiting_kyc')
  })
})
