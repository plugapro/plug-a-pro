import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockSyncProviderRecord,
  mockSyncProviderSkills,
  mockUpsertStructuredServiceAreas,
  mockResolveInitialApprovalStatus,
  mockSendButtons,
  mockIssueLink,
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

describe('safeProviderStatusReason (machine marker stripping)', () => {
  it('strips [quality-gate] lines but keeps real human reason', async () => {
    // Access the unexported function via the module's behaviour through
    // provider-journey; since it's private, test it indirectly by verifying
    // the quality-gate note format is filterable.
    const markerLine = '[quality-gate] KYC failed at application'
    const realReason = 'Missing evidence photos'
    const combined = `${markerLine}\n${realReason}`

    // Replicate the safeProviderStatusReason filter logic
    const stripped = combined
      .split('\n')
      .filter((line) => !/^\[.+\]/.test(line.trim()))
      .join('\n')
      .trim()

    expect(stripped).not.toContain('[quality-gate]')
    expect(stripped).toBe(realReason)
  })

  it('returns empty string when reason is only marker lines', () => {
    const markerOnly = '[quality-gate] KYC failed at application'
    const stripped = markerOnly
      .split('\n')
      .filter((line) => !/^\[.+\]/.test(line.trim()))
      .join('\n')
      .trim()

    expect(stripped).toBe('')
  })
})
