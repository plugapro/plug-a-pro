import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSyncProviderRecord,
  mockSyncProviderSkills,
  mockUpsertStructuredServiceAreas,
  mockResolveInitialApprovalStatus,
  mockSendButtons,
  mockIssueLink,
  mockSubmitProviderApplication,
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
  mockSubmitProviderApplication: vi.fn(),
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
}))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendButtons: mockSendButtons,
}))
vi.mock('@/lib/identity-verification/application-link', () => ({
  issueProviderApplicationVerificationLink: mockIssueLink,
}))
vi.mock('@/lib/provider-applications-submit', () => ({
  submitProviderApplication: mockSubmitProviderApplication,
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
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockDb.attachment.updateMany.mockResolvedValue({ count: 0 })
    mockDb.attachment.findUnique.mockResolvedValue(null)
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

    mockSubmitProviderApplication.mockResolvedValue({ application: { id: 'app-pwa-1' } })
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockSyncProviderRecord.mockResolvedValue('provider-pwa-1')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('creates a PENDING application via submitProviderApplication and returns applicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-pwa',
    })

    expect(result).toEqual({ applicationId: 'app-pwa-1' })

    expect(mockSubmitProviderApplication).toHaveBeenCalledOnce()
    expect(mockSubmitProviderApplication).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        phone: '+27821234567',
        name: 'PWA Resume Provider',
        skills: ['electrical'],
        evidenceFileUrls: ['https://example.com/evidence.pdf'],
        certificationRef: 'CERT-001',
      }),
      expect.objectContaining({ source: 'web' }),
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
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
  })
})

describe('recordFailedVerificationForApplication — PWA failure paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
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
    mockSubmitProviderApplication.mockResolvedValue({ application: { id: 'app-ss-1' } })
    mockDb.providerApplicationDraft.update.mockResolvedValue({})
    mockDb.providerIdentityVerification.update.mockResolvedValue({})
    mockResolveInitialApprovalStatus.mockResolvedValue('PENDING_REVIEW')
    mockSyncProviderSkills.mockResolvedValue(undefined)
    mockUpsertStructuredServiceAreas.mockResolvedValue(undefined)
    mockSendButtons.mockResolvedValue(undefined)
  })

  it('creates a PENDING application via submitProviderApplication and returns applicationId', async () => {
    const { completeApplicationForPassedVerification } = await import(
      '@/lib/provider-onboarding/quality-gate-submission'
    )

    const result = await completeApplicationForPassedVerification(mockDb as unknown as typeof import('@/lib/db').db, {
      verificationId: 'ver-ss',
    })

    expect(result).toEqual({ applicationId: 'app-ss-1' })

    expect(mockSubmitProviderApplication).toHaveBeenCalledOnce()
    expect(mockSubmitProviderApplication).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        phone: '+27829876543',
        name: 'PWA Self Serve Provider',
        skills: ['plumbing'],
        evidenceFileUrls: ['https://example.com/cert.pdf'],
        certificationRef: 'CERT-SS-001',
      }),
      expect.objectContaining({ source: 'web' }),
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
    // providerId from syncProviderRecord is passed to submitProviderApplication
    expect(mockSubmitProviderApplication).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ providerId: 'provider-ss-1' }),
      expect.anything(),
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
    expect(mockSubmitProviderApplication).not.toHaveBeenCalled()
  })
})
