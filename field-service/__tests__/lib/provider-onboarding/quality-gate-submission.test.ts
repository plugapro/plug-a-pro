import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSyncProviderRecord,
  mockSyncProviderSkills,
  mockUpsertStructuredServiceAreas,
  mockResolveInitialApprovalStatus,
  mockSendButtons,
  mockIssueLink,
  mockEvaluateEvidenceGate,
  mockEvaluateCertificationGate,
} = vi.hoisted(() => ({
  mockDb: {
    providerIdentityVerification: {
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    providerApplicationDraft: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    providerApplication: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    providerRate: {
      createMany: vi.fn(),
    },
    attachment: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    provider: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockSyncProviderRecord: vi.fn(),
  mockSyncProviderSkills: vi.fn(),
  mockUpsertStructuredServiceAreas: vi.fn(),
  mockResolveInitialApprovalStatus: vi.fn(),
  mockSendButtons: vi.fn(),
  mockIssueLink: vi.fn(),
  // Gate evaluators — default: pass (evidence ok, cert ok/not-required)
  mockEvaluateEvidenceGate: vi.fn(() => ({ ok: true, have: 3, need: 3 })),
  mockEvaluateCertificationGate: vi.fn(() => ({ required: false, ok: true })),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: mockSyncProviderRecord,
  upsertStructuredServiceAreas: mockUpsertStructuredServiceAreas,
}))
vi.mock('@/lib/provider-skills', () => ({
  syncProviderSkills: mockSyncProviderSkills,
}))
vi.mock('@/lib/provider-categories', () => ({
  resolveInitialApprovalStatus: mockResolveInitialApprovalStatus,
}))
vi.mock('@/lib/service-categories', () => ({
  resolveServiceCategoryTag: vi.fn((s: string) => s),
}))
vi.mock('@/lib/service-category-policy', () => ({
  getServiceComplianceRequirement: vi.fn(() => ({
    certificationRequiredForApproval: false,
    certificationRecommended: false,
  })),
  hasHighRiskServiceSelection: vi.fn(() => false),
}))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendButtons: mockSendButtons,
}))
vi.mock('@/lib/identity-verification/application-link', () => ({
  issueProviderApplicationVerificationLink: mockIssueLink,
}))
// quality-gate evaluators are mocked so tests control pass/fail independently
vi.mock('@/lib/provider-onboarding/quality-gate', () => ({
  evaluateEvidenceGate: mockEvaluateEvidenceGate,
  evaluateCertificationGate: mockEvaluateCertificationGate,
  isQualityGateV2Enabled: vi.fn().mockResolvedValue(false),
  MIN_EVIDENCE_PHOTOS: 3,
}))

// Helper: build a minimal PWA_RESUME submit payload
function buildPwaResumePayload(overrides?: Record<string, unknown>) {
  return {
    version: 1 as const,
    channel: 'PWA_RESUME' as const,
    submittedAt: '2026-07-04T00:00:00.000Z',
    phone: '+27821234567',
    name: 'PWA Resume Provider',
    idNumber: 'ID123456',
    skills: ['electrical'],
    serviceAreas: ['Johannesburg'],
    availability: 'Mon, Tue',
    experience: '3–5 years',
    evidenceNote: 'evidence note',
    evidenceFileUrls: ['https://example.com/evidence.pdf'],
    certificationRef: 'CERT-001',
    ctwaReferral: null,
    ...overrides,
  }
}

// Helper: build a minimal PWA_SELF_SERVE submit payload
function buildPwaSelfServePayload(overrides?: Record<string, unknown>) {
  return {
    version: 1 as const,
    channel: 'PWA_SELF_SERVE' as const,
    submittedAt: '2026-07-04T00:00:00.000Z',
    name: 'PWA Self Serve Provider',
    phone: '+27829876543',
    email: 'provider@example.com',
    skills: ['plumbing'],
    categorySlugs: ['plumbing'],
    serviceAreas: ['Cape Town'],
    locationNodeIds: ['loc-1'],
    experience: '1–3 years',
    availability: 'Any day',
    availabilityDays: ['Mon', 'Tue', 'Wed'],
    emergencyAvailable: false,
    callOutFee: 150,
    travelRadiusKm: 30,
    evidenceNote: 'my cert evidence',
    evidenceFileUrls: ['https://example.com/cert.pdf'],
    certificationRef: 'CERT-SS-001',
    reference1Name: 'Ref One',
    reference1Mobile: '+27831111111',
    reference2Name: null,
    reference2Mobile: null,
    bio: 'Experienced plumber',
    profilePhotoUrl: null,
    ...overrides,
  }
}

// Helper: build a minimal WHATSAPP submit payload
function buildPayload(overrides?: Record<string, unknown>) {
  return {
    version: 1 as const,
    channel: 'WHATSAPP' as const,
    submittedAt: '2026-07-04T00:00:00.000Z',
    normalizedPhone: '+27821234567',
    isTestUser: false,
    cohortName: null,
    canonicalSkills: ['plumbing'],
    categorySlugs: ['plumbing'],
    syncProviderArgs: {
      phone: '+27821234567',
      name: 'Test Provider',
      email: null,
      skills: ['plumbing'],
      serviceAreas: ['Johannesburg'],
      active: true,
      availableNow: true,
      verified: false,
      isTestUser: false,
      cohortName: null,
      locationNodeIds: [],
    },
    submitApplicationArgs: {
      phone: '+27821234567',
      name: 'Test Provider',
      idNumber: null,
      skills: ['plumbing'],
      serviceAreas: ['Johannesburg'],
      availability: 'Any day',
      experience: '1–3 years',
      evidenceNote: null,
      evidenceFileUrls: [],
      certificationRef: null,
      providerId: null,
      email: null,
      alternateMobileE164: null,
      preferredLanguage: null,
      reference1Name: null,
      reference1Mobile: null,
      reference2Name: null,
      reference2Mobile: null,
      callOutFee: null,
      hourlyRate: null,
      rateNegotiable: true,
      weekendJobs: false,
      sameDayJobs: true,
      isTestUser: false,
      cohortName: null,
      ctwaReferral: null,
    },
    replayInputs: {
      experience: '1–3 years',
      callOutFee: null,
      hourlyRate: null,
      rateNegotiable: true,
      certificationProofAttachmentIds: [],
      evidenceAttachmentIds: [],
      profilePhotoAttachmentId: null,
      providerBio: null,
      verificationDocAttachmentId: null,
      verificationSelfieAttachmentId: null,
      locationNodeIds: [],
      selectedRegionStatus: null,
    },
    ...overrides,
  }
}

describe('completeApplicationForPassedVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default gate evaluators: pass (evidence ok, cert not required)
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    // Default: verification has a draft
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: 'draft-1',
    })

    // Default: draft has no submitted application yet
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      submittedApplicationId: null,
      submitPayload: buildPayload(),
      phone: '+27821234567',
      name: 'Test Provider',
    })

    // Transaction executes the callback
    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      return fn(mockDb)
    })

    mockSyncProviderRecord.mockResolvedValue('provider-1')
    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-1' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-1' })
    // Default: no active application conflict (happy path)
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.attachment.updateMany.mockResolvedValue({ count: 0 })
    mockDb.attachment.findUnique.mockResolvedValue(null)
    mockDb.providerRate.createMany.mockResolvedValue({ count: 0 })
    mockResolveInitialApprovalStatus.mockResolvedValue('PENDING_REVIEW')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('WHATSAPP-channel draft: creates a PENDING application and returns applicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-1',
    })

    expect(result).toEqual({ applicationId: 'app-1' })

    // syncProviderRecord called with skipEnrichment: true
    expect(mockSyncProviderRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipEnrichment: true }),
    )

    // providerApplication.create called with PENDING status and the resolved providerId
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          phone: '+27821234567',
          providerId: 'provider-1',
        }),
      }),
    )

    // draft.submittedApplicationId updated
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-1' },
        data: { submittedApplicationId: 'app-1' },
      }),
    )

    // verification linked to application
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-1' },
        data: { providerApplicationId: 'app-1' },
      }),
    )
  })

  it('second call (draft already has submittedApplicationId): returns skipped already_submitted without re-submitting', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      submittedApplicationId: 'app-already',
      submitPayload: buildPayload(),
      phone: '+27821234567',
      name: 'Test Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-1',
    })

    expect(result).toEqual({ skipped: 'already_submitted' })
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
  })

  it('verification with no draft (providerApplicationDraftId null): returns skipped no_draft', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: null,
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-1',
    })

    expect(result).toEqual({ skipped: 'no_draft' })
    expect(mockDb.providerApplicationDraft.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
  })
})

describe('recordFailedVerificationForApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Gate evaluators: pass by default (failure tests don't call the PASS path)
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: 'draft-1',
    })

    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-1',
      submittedApplicationId: null,
      submitPayload: buildPayload(),
      phone: '+27821234567',
    })

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      return fn(mockDb)
    })

    mockSyncProviderRecord.mockResolvedValue('provider-1')
    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-fail' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-fail' })
    // Default: no active application conflict (happy path)
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockIssueLink.mockResolvedValue({ verificationId: 'ver-new', verificationUrl: 'https://verify.example.com', expiresAt: new Date(), reused: false })
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('2nd+ failure (count returns 2): creates MORE_INFO_REQUIRED application with [quality-gate] note', async () => {
    // count includes current — 2 means this is 2nd failure
    mockDb.providerIdentityVerification.count.mockResolvedValue(2)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-1',
    })

    // Application created with MORE_INFO_REQUIRED status
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'MORE_INFO_REQUIRED',
        }),
      }),
    )

    // Ops note appended
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-fail' },
        data: expect.objectContaining({
          notes: expect.stringContaining('[quality-gate]'),
        }),
      }),
    )

    // Re-issue link NOT called (this is 2nd failure, application is created)
    expect(mockIssueLink).not.toHaveBeenCalled()
  })

  it('1st failure (count returns 1): NO application created, re-issue link IS called', async () => {
    // count = 1 means this is the 1st failure
    mockDb.providerIdentityVerification.count.mockResolvedValue(1)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-1',
    })

    // No application created
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()

    // Verification link re-issued
    expect(mockIssueLink).toHaveBeenCalledWith(
      expect.objectContaining({ providerApplicationDraftId: 'draft-1' }),
    )
  })

  it('no draft (providerApplicationDraftId null): returns early without creating anything', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-1',
      providerApplicationDraftId: null,
    })

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-1',
    })

    expect(mockDb.providerIdentityVerification.count).not.toHaveBeenCalled()
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    expect(mockIssueLink).not.toHaveBeenCalled()
  })
})

describe('completeApplicationForPassedVerification — PWA_RESUME channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Gate evaluators: pass by default
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-pwa',
      providerApplicationDraftId: 'draft-pwa',
    })

    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa',
      submittedApplicationId: null,
      submitPayload: buildPwaResumePayload(),
      phone: '+27821234567',
      name: 'PWA Resume Provider',
    })

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      return fn(mockDb)
    })

    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-pwa-1' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-pwa-1' })
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.providerRate.createMany.mockResolvedValue({ count: 0 })
    mockSyncProviderRecord.mockResolvedValue('provider-pwa-1')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('creates a PENDING application inline and returns applicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa',
    })

    expect(result).toEqual({ applicationId: 'app-pwa-1' })

    // Uses inline create (not submitProviderApplication)
    expect(mockDb.providerApplication.create).toHaveBeenCalledOnce()
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '+27821234567',
          name: 'PWA Resume Provider',
          skills: ['electrical'],
          evidenceFileUrls: ['https://example.com/evidence.pdf'],
          status: 'PENDING',
        }),
      }),
    )
  })

  it('links draft.submittedApplicationId and verification.providerApplicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa',
    })

    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-pwa' },
        data: { submittedApplicationId: 'app-pwa-1' },
      }),
    )
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-pwa' },
        data: { providerApplicationId: 'app-pwa-1' },
      }),
    )
  })

  it('is idempotent: 2nd call (draft already has submittedApplicationId) returns skipped', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa',
      submittedApplicationId: 'app-already',
      submitPayload: buildPwaResumePayload(),
      phone: '+27821234567',
      name: 'PWA Resume Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa',
    })

    expect(result).toEqual({ skipped: 'already_submitted' })
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
  })

  // Fix A: PWA_RESUME PASS with existing active application → link, no throw, no duplicate
  it('Fix A — PWA_RESUME PASS: active application exists during KYC window → links draft, returns existing id, NO throw, NO duplicate', async () => {
    // The conflict is found inside the transaction (after the draft idempotency guard passes)
    mockDb.providerApplication.findFirst.mockResolvedValue({
      id: 'app-existing-resume',
      status: 'PENDING',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa',
    })

    expect(result).toEqual({ applicationId: 'app-existing-resume' })

    // No duplicate created
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()

    // Draft linked to the existing application id
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-pwa' },
        data: { submittedApplicationId: 'app-existing-resume' },
      }),
    )

    // Verification linked to existing application id
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-pwa' },
        data: { providerApplicationId: 'app-existing-resume' },
      }),
    )
  })
})

describe('recordFailedVerificationForApplication — PWA failure paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Gate evaluators: pass by default (failure path tests create MORE_INFO_REQUIRED directly)
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-pwa-fail',
      providerApplicationDraftId: 'draft-pwa-fail',
    })

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      return fn(mockDb)
    })

    mockSyncProviderRecord.mockResolvedValue('provider-pwa-fail-1')
    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-pwa-fail' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-pwa-fail' })
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.providerRate.createMany.mockResolvedValue({ count: 0 })
    mockIssueLink.mockResolvedValue({
      verificationId: 'ver-new',
      verificationUrl: 'https://verify.example.com',
      expiresAt: new Date(),
      reused: false,
    })
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('PWA_RESUME 2nd failure: creates MORE_INFO_REQUIRED application with [quality-gate] note', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: null,
      submitPayload: buildPwaResumePayload(),
      phone: '+27821234567',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(2)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    // Application created with MORE_INFO_REQUIRED
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'MORE_INFO_REQUIRED',
          phone: '+27821234567',
          name: 'PWA Resume Provider',
        }),
      }),
    )

    // [quality-gate] note appended
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-pwa-fail' },
        data: expect.objectContaining({
          notes: expect.stringContaining('[quality-gate]'),
        }),
      }),
    )

    // Links set
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-pwa-fail' },
        data: { submittedApplicationId: 'app-pwa-fail' },
      }),
    )
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-pwa-fail' },
        data: { providerApplicationId: 'app-pwa-fail' },
      }),
    )

    // No re-issue link (that is for 1st failure only)
    expect(mockIssueLink).not.toHaveBeenCalled()
    // No WhatsApp nudge to PWA applicant
    expect(mockSendButtons).not.toHaveBeenCalled()
  })

  it('PWA_RESUME 2nd failure: idempotent — 2nd call (draft already has submittedApplicationId) skips', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: 'app-already',
      submitPayload: buildPwaResumePayload(),
      phone: '+27821234567',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(2)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    // Already submitted — no new application created
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    expect(mockIssueLink).not.toHaveBeenCalled()
  })

  it('PWA_SELF_SERVE 2nd failure: syncs provider and creates MORE_INFO_REQUIRED application with [quality-gate] note', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: null,
      submitPayload: buildPwaSelfServePayload(),
      phone: '+27829876543',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(2)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    // Provider record synced first
    expect(mockSyncProviderRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipEnrichment: true, phone: '+27829876543' }),
    )

    // Application created with MORE_INFO_REQUIRED and correct fields
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'MORE_INFO_REQUIRED',
          phone: '+27829876543',
          name: 'PWA Self Serve Provider',
          providerId: 'provider-pwa-fail-1',
        }),
      }),
    )

    // [quality-gate] note appended
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-pwa-fail' },
        data: expect.objectContaining({
          notes: expect.stringContaining('[quality-gate]'),
        }),
      }),
    )

    // Links set
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-pwa-fail' },
        data: { submittedApplicationId: 'app-pwa-fail' },
      }),
    )
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-pwa-fail' },
        data: { providerApplicationId: 'app-pwa-fail' },
      }),
    )

    // No WhatsApp nudge to PWA applicant
    expect(mockSendButtons).not.toHaveBeenCalled()
  })

  it('PWA_SELF_SERVE 2nd failure: idempotent — skips if draft already submitted', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: 'app-already',
      submitPayload: buildPwaSelfServePayload(),
      phone: '+27829876543',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(2)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    expect(mockIssueLink).not.toHaveBeenCalled()
  })

  it('PWA_RESUME 1st failure: re-issues link with channel PWA, no application created, no WhatsApp nudge', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: null,
      submitPayload: buildPwaResumePayload(),
      phone: '+27821234567',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(1)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    // No application created
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()

    // Link re-issued with PWA channel (not WHATSAPP)
    expect(mockIssueLink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerApplicationDraftId: 'draft-pwa-fail',
        channel: 'PWA',
      }),
    )

    // No WhatsApp message sent to PWA applicant
    expect(mockSendButtons).not.toHaveBeenCalled()
  })

  it('PWA_SELF_SERVE 1st failure: re-issues link with channel PWA, no application created, no WhatsApp nudge', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: null,
      submitPayload: buildPwaSelfServePayload(),
      phone: '+27829876543',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(1)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    // No application created
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()

    // Link re-issued with PWA channel
    expect(mockIssueLink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerApplicationDraftId: 'draft-pwa-fail',
        channel: 'PWA',
      }),
    )

    // No WhatsApp nudge for PWA applicant
    expect(mockSendButtons).not.toHaveBeenCalled()
  })

  it('WHATSAPP 1st failure: re-issues with WHATSAPP channel and DOES send WhatsApp nudge', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-fail',
      submittedApplicationId: null,
      submitPayload: buildPayload(),
      phone: '+27821234567',
    })
    mockDb.providerIdentityVerification.count.mockResolvedValue(1)

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa-fail',
    })

    // Link re-issued with WHATSAPP channel
    expect(mockIssueLink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerApplicationDraftId: 'draft-pwa-fail',
        channel: 'WHATSAPP',
      }),
    )

    // WhatsApp nudge IS sent for WHATSAPP channel applicants
    expect(mockSendButtons).toHaveBeenCalledOnce()
  })
})

describe('completeApplicationForPassedVerification — PWA_SELF_SERVE channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Gate evaluators: pass by default
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-ss',
      providerApplicationDraftId: 'draft-ss',
    })

    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-ss',
      submittedApplicationId: null,
      submitPayload: buildPwaSelfServePayload(),
      phone: '+27829876543',
      name: 'PWA Self Serve Provider',
    })

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      return fn(mockDb)
    })

    mockSyncProviderRecord.mockResolvedValue('provider-ss-1')
    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-ss-1' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-ss-1' })
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.providerRate.createMany.mockResolvedValue({ count: 0 })
    mockResolveInitialApprovalStatus.mockResolvedValue('PENDING_REVIEW')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('creates a PENDING application inline and returns applicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-ss',
    })

    expect(result).toEqual({ applicationId: 'app-ss-1' })

    // Uses inline create
    expect(mockDb.providerApplication.create).toHaveBeenCalledOnce()
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '+27829876543',
          name: 'PWA Self Serve Provider',
          skills: ['plumbing'],
          evidenceFileUrls: ['https://example.com/cert.pdf'],
          status: 'PENDING',
        }),
      }),
    )
  })

  it('syncs provider record first (provider does not exist yet for self-serve)', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-ss',
    })

    expect(mockSyncProviderRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipEnrichment: true, phone: '+27829876543' }),
    )
    // providerId from syncProviderRecord is included on the created application
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerId: 'provider-ss-1' }),
      }),
    )
  })

  it('links draft.submittedApplicationId and verification.providerApplicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-ss',
    })

    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-ss' },
        data: { submittedApplicationId: 'app-ss-1' },
      }),
    )
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-ss' },
        data: { providerApplicationId: 'app-ss-1' },
      }),
    )
  })

  it('is idempotent: 2nd call (draft already has submittedApplicationId) returns skipped', async () => {
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-ss',
      submittedApplicationId: 'app-already',
      submitPayload: buildPwaSelfServePayload(),
      phone: '+27829876543',
      name: 'PWA Self Serve Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-ss',
    })

    expect(result).toEqual({ skipped: 'already_submitted' })
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
  })

  // Fix A: PWA_SELF_SERVE PASS with existing active application → link, no throw, no duplicate
  it('Fix A — PWA_SELF_SERVE PASS: active application exists during KYC window → links draft, returns existing id, NO throw, NO duplicate', async () => {
    mockDb.providerApplication.findFirst.mockResolvedValue({
      id: 'app-existing-ss',
      status: 'APPROVED',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-ss',
    })

    expect(result).toEqual({ applicationId: 'app-existing-ss' })

    // No duplicate created
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()

    // Draft linked to existing application
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-ss' },
        data: { submittedApplicationId: 'app-existing-ss' },
      }),
    )

    // Verification linked to existing application
    expect(mockDb.providerIdentityVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ver-ss' },
        data: { providerApplicationId: 'app-existing-ss' },
      }),
    )
  })
})

describe('P1: completion defense-in-depth — re-check for active application before creating duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Gate evaluators: pass by default
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb))
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.attachment.updateMany.mockResolvedValue({ count: 0 })
    mockDb.attachment.findUnique.mockResolvedValue(null)
    mockDb.providerRate.createMany.mockResolvedValue({ count: 0 })
    mockResolveInitialApprovalStatus.mockResolvedValue('PENDING_REVIEW')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('createApplicationInline (WHATSAPP PASS): active app appears during KYC window → returns existing id, no duplicate, and LINKS the draft', async () => {
    // Draft has no submittedApplicationId (came in clean)
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-race',
      providerApplicationDraftId: 'draft-race',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-race',
      submittedApplicationId: null,
      submitPayload: buildPayload({ normalizedPhone: '+27821111999' }),
      phone: '+27821111999',
      name: 'Race Condition Test',
    })

    mockSyncProviderRecord.mockResolvedValue('prov-race')

    // The conflict re-check in createApplicationInline finds an existing PENDING app
    mockDb.providerApplication.findFirst.mockResolvedValue({
      id: 'app-race-existing',
      phone: '+27821111999',
      status: 'PENDING',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(
      mockDb as unknown as typeof import('@/lib/db').db,
      { verificationId: 'ver-race' },
    )

    expect(result).toEqual({ applicationId: 'app-race-existing' })
    // The defense-in-depth guard short-circuits before create
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    // Fix 2: draft MUST be linked to the existing application (not left dangling)
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft-race' },
        data: { submittedApplicationId: 'app-race-existing' },
      }),
    )
  })

  it('createPwaApplicationInline (PWA_RESUME 2nd fail): active app appears before 2nd fail → returns existing id, no duplicate created', async () => {
    // 2nd KYC failure on a PWA_RESUME draft — this calls createPwaApplicationInline
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-pwa-race',
      providerApplicationDraftId: 'draft-pwa-race',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-pwa-race',
      submittedApplicationId: null,
      submitPayload: buildPwaResumePayload({ phone: '+27821111998' }),
      phone: '+27821111998',
    })
    // 2nd failure (count ≥ 2) triggers createPwaApplicationInline instead of re-issue
    mockDb.providerIdentityVerification.count.mockResolvedValue(2)

    // Defense-in-depth: active app already exists when createPwaApplicationInline fires
    mockDb.providerApplication.findFirst.mockResolvedValue({
      id: 'app-pwa-race-existing',
      phone: '+27821111998',
      status: 'APPROVED',
    })

    const { recordFailedVerificationForApplication } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await recordFailedVerificationForApplication(
      mockDb as unknown as typeof import('@/lib/db').db,
      { verificationId: 'ver-pwa-race' },
    )

    // Defense-in-depth guard short-circuits before create; existing app id reused
    expect(mockDb.providerApplication.create).not.toHaveBeenCalled()
    // Draft was linked to the existing app id
    expect(mockDb.providerApplicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { submittedApplicationId: 'app-pwa-race-existing' },
      }),
    )
  })
})

describe('Fix B: evidence gate defense-in-depth — createApplicationInline never creates PENDING below the bar', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb))
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.attachment.updateMany.mockResolvedValue({ count: 0 })
    mockDb.attachment.findUnique.mockResolvedValue(null)
    mockDb.providerRate.createMany.mockResolvedValue({ count: 0 })
    mockDb.providerApplication.findFirst.mockResolvedValue(null) // no conflict
    mockResolveInitialApprovalStatus.mockResolvedValue('PENDING_REVIEW')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
    mockSyncProviderRecord.mockResolvedValue('provider-gate-1')
  })

  it('WHATSAPP PASS with <3 evidence photos: creates MORE_INFO_REQUIRED (not PENDING) with [quality-gate] note', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-gate-b',
      providerApplicationDraftId: 'draft-gate-b',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-gate-b',
      submittedApplicationId: null,
      // Payload with only 1 evidence photo — below the 3-photo minimum
      submitPayload: buildPayload({
        submitApplicationArgs: {
          phone: '+27821234567',
          name: 'Under-qualified Provider',
          idNumber: null,
          skills: ['plumbing'],
          serviceAreas: ['Johannesburg'],
          availability: 'Any day',
          experience: '1–3 years',
          evidenceNote: null,
          evidenceFileUrls: ['https://example.com/photo1.jpg'], // only 1 photo
          certificationRef: null,
          providerId: null,
          email: null,
          alternateMobileE164: null,
          preferredLanguage: null,
          reference1Name: null,
          reference1Mobile: null,
          reference2Name: null,
          reference2Mobile: null,
          callOutFee: null,
          hourlyRate: null,
          rateNegotiable: true,
          weekendJobs: false,
          sameDayJobs: true,
          isTestUser: false,
          cohortName: null,
          ctwaReferral: null,
        },
      }),
      phone: '+27821234567',
      name: 'Under-qualified Provider',
    })

    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-gate-b' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-gate-b' })

    // Gate evaluator: evidence FAILS (only 1 photo, need 3)
    mockEvaluateEvidenceGate.mockReturnValue({ ok: false, have: 1, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(
      mockDb as unknown as typeof import('@/lib/db').db,
      { verificationId: 'ver-gate-b' },
    )

    // A result is returned (applicant stays in ops queue, not silently dropped)
    expect(result).toMatchObject({ applicationId: expect.any(String) })

    // Application MUST be created as MORE_INFO_REQUIRED, never PENDING
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'MORE_INFO_REQUIRED',
        }),
      }),
    )
    // Confirm no PENDING application was created
    const createCall = mockDb.providerApplication.create.mock.calls[0][0]
    expect(createCall.data.status).not.toBe('PENDING')

    // [quality-gate] note added
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notes: expect.stringContaining('[quality-gate]'),
        }),
      }),
    )
  })

  it('WHATSAPP PASS with high-risk skill but no certificationRef: creates MORE_INFO_REQUIRED', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-gate-cert',
      providerApplicationDraftId: 'draft-gate-cert',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-gate-cert',
      submittedApplicationId: null,
      submitPayload: buildPayload({
        submitApplicationArgs: {
          phone: '+27821234567',
          name: 'High Risk Provider',
          idNumber: null,
          skills: ['electrical_high_risk'],
          serviceAreas: ['Johannesburg'],
          availability: 'Any day',
          experience: '5+ years',
          evidenceNote: null,
          evidenceFileUrls: ['a.jpg', 'b.jpg', 'c.jpg'], // 3 photos — evidence ok
          certificationRef: null, // missing cert — high-risk skill
          providerId: null,
          email: null,
          alternateMobileE164: null,
          preferredLanguage: null,
          reference1Name: null,
          reference1Mobile: null,
          reference2Name: null,
          reference2Mobile: null,
          callOutFee: null,
          hourlyRate: null,
          rateNegotiable: true,
          weekendJobs: false,
          sameDayJobs: true,
          isTestUser: false,
          cohortName: null,
          ctwaReferral: null,
        },
      }),
      phone: '+27821234567',
      name: 'High Risk Provider',
    })

    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-gate-cert' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-gate-cert' })

    // Evidence passes, cert fails (high-risk, no cert)
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: true, ok: false })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(
      mockDb as unknown as typeof import('@/lib/db').db,
      { verificationId: 'ver-gate-cert' },
    )

    // Must create MORE_INFO_REQUIRED, not PENDING
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'MORE_INFO_REQUIRED' }),
      }),
    )
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: expect.stringContaining('[quality-gate]') }),
      }),
    )
  })
})

describe('Fix C: providerRate rows replayed on PASS', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Gate evaluators: pass by default
    mockEvaluateEvidenceGate.mockReturnValue({ ok: true, have: 3, need: 3 })
    mockEvaluateCertificationGate.mockReturnValue({ required: false, ok: true })

    mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb))
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.attachment.updateMany.mockResolvedValue({ count: 0 })
    mockDb.attachment.findUnique.mockResolvedValue(null)
    mockDb.providerApplication.findFirst.mockResolvedValue(null)
    mockDb.providerApplication.create.mockResolvedValue({ id: 'app-rate-test' })
    mockDb.providerApplication.update.mockResolvedValue({ id: 'app-rate-test' })
    mockDb.providerRate.createMany.mockResolvedValue({ count: 1 })
    mockResolveInitialApprovalStatus.mockResolvedValue('PENDING_REVIEW')
    mockSyncProviderRecord.mockResolvedValue('provider-rate-test')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('WHATSAPP PASS with callOutFee present: providerRate.createMany called with rate data', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-rate-wa',
      providerApplicationDraftId: 'draft-rate-wa',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-rate-wa',
      submittedApplicationId: null,
      submitPayload: buildPayload({
        replayInputs: {
          experience: '3–5 years',
          callOutFee: 250,
          hourlyRate: 150,
          rateNegotiable: true,
          certificationProofAttachmentIds: [],
          evidenceAttachmentIds: [],
          profilePhotoAttachmentId: null,
          providerBio: null,
          verificationDocAttachmentId: null,
          verificationSelfieAttachmentId: null,
          locationNodeIds: [],
          selectedRegionStatus: null,
        },
      }),
      phone: '+27821234567',
      name: 'Test Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-rate-wa',
    })

    expect(mockDb.providerRate.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            providerId: 'provider-rate-test',
            callOutFee: 250,
            hourlyRate: 150,
            rateNegotiable: true,
          }),
        ]),
        skipDuplicates: true,
      }),
    )
  })

  it('WHATSAPP PASS without callOutFee: providerRate.createMany NOT called', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-rate-wa-no-fee',
      providerApplicationDraftId: 'draft-rate-wa-no-fee',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-rate-wa-no-fee',
      submittedApplicationId: null,
      submitPayload: buildPayload(), // callOutFee: null in replayInputs
      phone: '+27821234567',
      name: 'Test Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-rate-wa-no-fee',
    })

    expect(mockDb.providerRate.createMany).not.toHaveBeenCalled()
  })

  it('PWA_SELF_SERVE PASS with callOutFee present: providerRate.createMany called with rate data', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-rate-ss',
      providerApplicationDraftId: 'draft-rate-ss',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-rate-ss',
      submittedApplicationId: null,
      // buildPwaSelfServePayload has callOutFee: 150, hourlyRate not set by default
      submitPayload: buildPwaSelfServePayload({ hourlyRate: 480 }),
      phone: '+27829876543',
      name: 'PWA Self Serve Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-rate-ss',
    })

    expect(mockDb.providerRate.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            providerId: 'provider-rate-test',
            callOutFee: 150,
            hourlyRate: 480,
          }),
        ]),
        skipDuplicates: true,
      }),
    )
  })

  it('PWA_SELF_SERVE PASS without callOutFee: providerRate.createMany NOT called', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-rate-ss-no-fee',
      providerApplicationDraftId: 'draft-rate-ss-no-fee',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-rate-ss-no-fee',
      submittedApplicationId: null,
      submitPayload: buildPwaSelfServePayload({ callOutFee: null }),
      phone: '+27829876543',
      name: 'PWA Self Serve Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-rate-ss-no-fee',
    })

    expect(mockDb.providerRate.createMany).not.toHaveBeenCalled()
  })

  it('PWA_RESUME PASS: hourlyRate from submitPayload is stored on the created application', async () => {
    mockDb.providerIdentityVerification.findUniqueOrThrow.mockResolvedValue({
      id: 'ver-rate-resume',
      providerApplicationDraftId: 'draft-rate-resume',
    })
    mockDb.providerApplicationDraft.findUniqueOrThrow.mockResolvedValue({
      id: 'draft-rate-resume',
      submittedApplicationId: null,
      submitPayload: buildPwaResumePayload({ hourlyRate: 350 }),
      phone: '+27821234567',
      name: 'PWA Resume Provider',
    })

    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-rate-resume',
    })

    // hourlyRate is stored on the application row (PWA_RESUME has no callOutFee so no providerRate rows)
    expect(mockDb.providerApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hourlyRate: 350 }),
      }),
    )
    // No providerRate rows since PWA_RESUME payload has no callOutFee
    expect(mockDb.providerRate.createMany).not.toHaveBeenCalled()
  })
})
