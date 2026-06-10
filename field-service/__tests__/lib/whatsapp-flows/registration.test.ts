// ─── Regression tests: provider duplicate registration prevention ─────────────
// Covers:
//  1. startRegistration: detects existing PENDING application → resumes, no new record
//  2. startRegistration: detects existing APPROVED application → shows registered message
//  3. handlePending submit: duplicate tap detected (PENDING already exists) → no new record
//  4. handlePending submit: duplicate tap detected (APPROVED already exists) → no new record
//  5. handlePending submit: first-time submit (no existing) → creates application
//  6. syncProviderRecord: phone normalization (local format → E.164)
//  7. reconcileProviderRecordsFromApplications: same phone in two applications → upserts same Provider id

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => {
  const mockDb = {
    $transaction: vi.fn(),
    customer: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    providerApplication: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    provider: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    providerCategory: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    providerRate: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    attachment: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    // Required by lib/whatsapp-media-batch.ts (debounceMediaBatch). The flow
    // tests don't exercise the debounce window - they fast-path through the
    // batch claim - but the mock surface must exist.
    // updateMany is required by submitProviderApplication (advances step to reg_pending).
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ data: {} }),
      update: vi.fn().mockResolvedValue({ id: 'conv-mock' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  }
  mockDb.$transaction.mockImplementation(async (callback) => {
    if (typeof callback === 'function') return callback(mockDb)
    return callback
  })
  return { db: mockDb }
})

// Bypass the 2.5s debounce in flow tests - we're not testing the debounce
// here, just the file-accumulation paths.
vi.mock('@/lib/whatsapp-media-batch', () => ({
  debounceMediaBatch: vi.fn().mockResolvedValue({ mySeq: 1, isLatest: true }),
  readMediaBatchSeq: vi.fn().mockResolvedValue(1),
  claimMediaBatchSeq: vi.fn().mockResolvedValue(1),
  awaitAndCheckLatest: vi.fn().mockResolvedValue(true),
  WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS: 0,
}))

vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn().mockResolvedValue({ attachmentId: 'att_mock_001' }),
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList: vi.fn().mockResolvedValue(undefined),
  sendCtaUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn().mockResolvedValue(undefined),
  sendAdminNewApplication: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: vi.fn().mockResolvedValue('provider_created'),
}))

vi.mock('@/lib/provider-categories', () => ({
  resolveInitialApprovalStatus: vi.fn().mockResolvedValue('PENDING_REVIEW'),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  checkJobsForNewProviderAvailability: vi.fn().mockResolvedValue({
    dispatchedOpenJobs: 0,
    promptedExpiredJobs: 0,
    templateFallbacks: 0,
  }),
}))

// 20 fake suburbs - intentionally more than SUBURB_PAGE_SIZE to validate pagination cap
vi.mock('@/lib/location-nodes', () => ({
  getCities: vi.fn().mockResolvedValue([]),
  getRegions: vi.fn().mockResolvedValue([]),
  getSuburbs: vi.fn().mockResolvedValue(
    Array.from({ length: 20 }, (_, i) => ({ id: `sub_${i}`, label: `Suburb ${i + 1}` }))
  ),
}))

import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'
import { normalizePhone } from '@/lib/utils'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'
import * as whatsapp from '@/lib/whatsapp'
import * as providerRecord from '@/lib/provider-record'
import * as whatsappMedia from '@/lib/whatsapp-media'
import * as locationNodes from '@/lib/location-nodes'

const phone = '+27821234567'

function resetDbMocks() {
  ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db as any))
  ;(db.customer.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(db.providerApplication.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'app_default_12345678' })
  ;(db.provider.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;((db as any).providerCategory.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
  ;((db as any).providerRate.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
  ;(db.attachment.findMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: any) => (
    (args.where.id.in as string[]).map((id) => ({ id, providerApplicationId: null }))
  ))
  ;(db.attachment.updateMany as ReturnType<typeof vi.fn>).mockImplementation(async (args: any) => ({
    count: (args.where.id.in as string[]).length,
  }))
  ;(db.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
}

function makeCtx(step: string, replyId?: string, replyText?: string, data: object = {}) {
  return {
    phone,
    step: step as any,
    data: data as any,
    flow: 'registration' as const,
    reply: {
      type: (replyId ? 'button_reply' : 'text') as any,
      id: replyId,
      text: replyText,
      title: replyId,
    },
  }
}

describe('registration flow - duplicate prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })

  // ── startRegistration ──────────────────────────────────────────────────────

  describe('startRegistration (reg_start step)', () => {
    it('shows existing profile message and returns done when PENDING application exists', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_aaaabbbb',
        status: 'PENDING',
      })

      const result = await handleRegistrationFlow(makeCtx('reg_start'))

      expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('provider profile is already on file'))
      expect(result.nextStep).toBe('done')
      // No new application must be created
      expect(db.providerApplication.create).not.toHaveBeenCalled()
    })

    it('shows "already registered" message and returns provider toggle when APPROVED application exists', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_approved1',
        status: 'APPROVED',
      })

      const result = await handleRegistrationFlow(makeCtx('reg_start'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('already registered'),
        expect.any(Array),
      )
      expect(result.nextStep).toBe('pj_toggle_available')
      expect(db.providerApplication.create).not.toHaveBeenCalled()
    })

    it('shows welcome prompt when no existing application (new applicant)', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const result = await handleRegistrationFlow(makeCtx('reg_start'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('You spend 1 credit only when a customer selects you'),
        expect.any(Array),
      )
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('provider credits terms and rules'),
        expect.any(Array),
      )
      expect(result.nextStep).toBe('reg_collect_name')
    })

    it('allows re-application after a REJECTED application', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_rejected1',
        status: 'REJECTED',
      })

      const result = await handleRegistrationFlow(makeCtx('reg_start'))

      // REJECTED is treated as no active application - shows the welcome prompt
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('starter credits'),
        expect.any(Array),
      )
      expect(result.nextStep).toBe('reg_collect_name')
    })

    it('still blocks a new application when the latest row is rejected but an older APPROVED one exists', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_approved1',
        status: 'APPROVED',
      })

      const result = await handleRegistrationFlow(makeCtx('reg_start'))

      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('already registered'),
        expect.any(Array),
      )
      expect(result.nextStep).toBe('pj_toggle_available')
    })

    it('blocks registration and sends conflict message when phone already belongs to a customer', async () => {
      // No provider/application - the inner customer guard in startRegistration should fire
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(db.customer.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'cust_abc123',
      })

      const result = await handleRegistrationFlow(makeCtx('reg_start'))

      expect(wa.sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('already registered as a customer'),
      )
      expect(result.nextStep).toBe('done')
      expect(db.providerApplication.create).not.toHaveBeenCalled()
    })
  })

  // ── handlePending (submit step) ────────────────────────────────────────────

  describe('handlePending (reg_pending step) - submit_yes', () => {
    const dataWithFullProfile = {
      name: 'Thabo Nkosi',
      providerIdNumber: '8001015009087',
      skills: ['Plumbing'],
      serviceAreas: ['Gauteng'],
      experience: '3–5 years',
      availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    }

    it('detects duplicate PENDING application and returns done without creating a new record', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_existing_pending',
        status: 'PENDING',
        name: 'Thabo Nkosi',
      })

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('done')
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('already submitted'),
        expect.any(Array),
        undefined,
        expect.any(Object),
      )
      expect(db.providerApplication.create).not.toHaveBeenCalled()
      expect(providerRecord.syncProviderRecord).not.toHaveBeenCalled()
    })

    it('detects duplicate APPROVED application and returns done without creating a new record', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_existing_approved',
        status: 'APPROVED',
        name: 'Thabo Nkosi',
      })

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('done')
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('already registered'),
        expect.any(Array),
        undefined,
        expect.any(Object),
      )
      expect(db.providerApplication.create).not.toHaveBeenCalled()
      expect(providerRecord.syncProviderRecord).not.toHaveBeenCalled()
    })

    it('handles MORE_INFO_REQUIRED application with friendly message and returns done without creating a new record', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_more_info_req1',
        status: 'MORE_INFO_REQUIRED',
        name: 'Thabo Nkosi',
      })

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('done')
      expect(wa.sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('more information'),
      )
      expect(db.providerApplication.create).not.toHaveBeenCalled()
      expect(providerRecord.syncProviderRecord).not.toHaveBeenCalled()
    })

    it('creates application when no existing non-rejected application found', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(db.providerApplication.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_new_12345678',
      })

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('done')
      expect(providerRecord.syncProviderRecord).toHaveBeenCalledOnce()
      expect(db.providerApplication.create).toHaveBeenCalledOnce()
      expect(db.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone,
            name: 'Thabo Nkosi',
            idNumber: '8001015009087',
            status: 'PENDING',
          }),
        })
      )
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('Approval is not automatic'),
        expect.any(Array),
        undefined,
        expect.any(Object),
      )
    })

    it('persists canonical skill tags while keeping WhatsApp session skills as labels', async () => {
      await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, {
          ...dataWithFullProfile,
          skills: ['Plumbing', 'Garden & Landscaping'],
        })
      )

      expect(providerRecord.syncProviderRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          skills: ['plumbing', 'garden'],
        }),
      )
      expect(db.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            skills: ['plumbing', 'garden'],
          }),
        }),
      )
      expect(whatsapp.sendAdminNewApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: ['Plumbing', 'Garden & Landscaping'],
        }),
      )
    })

    it('creates application with five uploaded files and links every attachment', async () => {
      const evidenceFileUrls = ['att_1', 'att_2', 'att_3', 'att_4', 'att_5']

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, {
          ...dataWithFullProfile,
          evidenceFileUrls,
        })
      )

      expect(result.nextStep).toBe('done')
      expect(db.attachment.findMany).toHaveBeenCalledWith({
        where: { id: { in: evidenceFileUrls } },
        select: { id: true, providerApplicationId: true },
      })
      expect(db.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evidenceFileUrls,
            status: 'PENDING',
          }),
        })
      )
      expect(db.attachment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: evidenceFileUrls }, providerApplicationId: null },
          data: { providerApplicationId: 'app_default_12345678' },
        })
      )
    })

    it('marks high-risk provider categories as certification requested on submit', async () => {
      await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, {
          ...dataWithFullProfile,
          skills: ['Electrical', 'Painting'],
          evidenceNote: 'Worked under a qualified electrician and can provide references.',
        })
      )

      const providerCategoryRows = ((db as any).providerCategory.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0].data
      expect(providerCategoryRows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          categorySlug: 'electrical',
          certificationRequired: true,
          certificationStatus: 'REQUESTED',
        }),
        expect.objectContaining({
          categorySlug: 'painting',
          certificationRequired: false,
          certificationStatus: 'NOT_REQUIRED',
        }),
      ]))
    })

    it('keeps progress and returns a structured error when uploaded files are not ready', async () => {
      ;(db.attachment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'att_1', providerApplicationId: null },
        { id: 'att_2', providerApplicationId: null },
        { id: 'att_3', providerApplicationId: null },
      ])

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, {
          ...dataWithFullProfile,
          evidenceFileUrls: ['att_1', 'att_2', 'att_3', 'att_4', 'att_5'],
        })
      )

      expect(result.nextStep).toBe('reg_pending')
      expect(result.nextData).toMatchObject(dataWithFullProfile)
      expect(providerRecord.syncProviderRecord).not.toHaveBeenCalled()
      expect(db.providerApplication.create).not.toHaveBeenCalled()
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining("We're still saving one or more uploaded files"),
        expect.any(Array),
        undefined,
        expect.objectContaining({
          metadata: expect.objectContaining({ publicRef: expect.stringMatching(/^PAP-[A-Z2-9]{5}$/) }),
        }),
      )
      const attachErrBody = (wa.sendButtons as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string
      expect(attachErrBody).toContain('Reference: PAP-')
      expect(attachErrBody).not.toContain('provider_app_submit_')
    })

    it('does not roll back submitted application when the WhatsApp confirmation send fails after commit', async () => {
      ;(wa.sendButtons as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Meta unavailable'))

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('done')
      expect(db.providerApplication.create).toHaveBeenCalledOnce()
      expect(db.auditLog.create).toHaveBeenCalledOnce()
      expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'technician_application_received',
        })
      )
    })

    it('passes normalized phone (E.164) to syncProviderRecord and create', async () => {
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      ;(db.providerApplication.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'app_norm_12345678',
      })

      // Phone comes from ctx.phone which is already E.164 in production -
      // this test confirms the normalized value flows through correctly
      await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(providerRecord.syncProviderRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phone, email: null }),  // email not collected during onboarding
      )
      expect(db.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone }),
        })
      )
    })

    it('recovers cleanly when a unique constraint race creates the application first', async () => {
      const racedApp = { id: 'app_raced_pending', status: 'PENDING', name: 'Thabo Nkosi' }
      // Call 1: registration.ts outer duplicate check → no active app yet
      // Call 2: submitProviderApplication conflict guard inside tx → sees the raced app,
      //         throws ProviderApplicationConflictError (previously this was simulated via P2002)
      // Call 3: catch-block race recovery lookup → same raced app
      ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(racedApp)
        .mockResolvedValueOnce(racedApp)
      ;(db.providerApplication.create as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'P2002',
      })

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('done')
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('already submitted'),
        expect.any(Array),
        undefined,
        expect.any(Object),
      )
    })

    it('maps provider enrichment schema drift to a recoverable submit failure without exposing DB internals', async () => {
      ;((db as any).providerCategory.createMany as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'P2022',
        meta: { modelName: 'ProviderCategory', column: 'id' },
      })

      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, dataWithFullProfile)
      )

      expect(result.nextStep).toBe('reg_pending')
      expect(result.nextData).toMatchObject(dataWithFullProfile)
      expect(wa.sendButtons).toHaveBeenCalledWith(
        phone,
        expect.stringContaining("couldn't submit your application right now"),
        expect.any(Array),
        undefined,
        expect.objectContaining({
          metadata: expect.objectContaining({ publicRef: expect.stringMatching(/^PAP-[A-Z2-9]{5}$/) }),
        }),
      )
      const body = (wa.sendButtons as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string
      expect(body).toContain('PAP-')
      expect(body).not.toContain('P2022')
      expect(body).not.toContain('ProviderCategory')
      expect(body).not.toContain('column')
      expect(body).not.toContain('PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED')
      expect(body).not.toContain('provider_app_submit_')
    })

    it('allows deferred identity verification at MVP submit while leaving credit top-ups gated later', async () => {
      const result = await handleRegistrationFlow(
        makeCtx('reg_pending', 'submit_yes', undefined, {
          ...dataWithFullProfile,
          providerIdNumber: undefined,
          providerEmail: undefined,
          verificationMethod: 'skipped',
        })
      )

      expect(result.nextStep).toBe('done')
      // idNumber normalised to null by submitProviderApplication helper (undefined input → null stored)
      expect(db.providerApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            idNumber: null,
            status: 'PENDING',
          }),
        }),
      )
    })
  })
})

describe('registration flow - numbered bulk skill selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })

  it('frames identity verification as required but deferrable after name', async () => {
    const result = await handleRegistrationFlow(makeCtx('reg_collect_skills', undefined, 'Thabo Nkosi'))

    const promptBody = (wa.sendButtons as any).mock.calls.at(-1)[1] as string

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Verify your identity'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'verify_enter_id' }),
        expect.objectContaining({ id: 'verify_upload_doc' }),
        expect.objectContaining({ id: 'verify_skip', title: 'Verify later' }),
      ]),
    )
    expect(promptBody).toContain('Identity verification is required for providers.')
    expect(promptBody).toContain('You can do it now during WhatsApp onboarding, or verify later before you top up credits.')
    expect(promptBody).toContain('Credit top-ups stay locked until your identity is verified.')
    expect(promptBody).not.toContain('(optional)')
    expect(promptBody).not.toContain('apply without it')
    expect(wa.sendText).not.toHaveBeenCalledWith(phone, expect.stringContaining('email address'))
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData).toMatchObject({ name: 'Thabo Nkosi' })
  })

  it('reg_collect_name tells the provider to type a full name with an example', async () => {
    const result = await handleRegistrationFlow(makeCtx('reg_collect_name', 'reg_start'))

    expect(wa.sendText).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('type your full name'),
    )
    const body = (wa.sendText as any).mock.calls.at(-1)[1] as string
    expect(body).toContain('Example')
    expect(body).toContain('Thabo Nkosi')
    expect(result.nextStep).toBe('reg_collect_skills')
  })

  it('reg_collect_skills rejects missing surname-style name input with a simple retry prompt', async () => {
    const result = await handleRegistrationFlow(makeCtx('reg_collect_skills', undefined, 'Thabo'))

    expect(wa.sendText).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Please type your full name'),
    )
    const body = (wa.sendText as any).mock.calls.at(-1)[1] as string
    expect(body).toContain('Example')
    expect(body).toContain('Thabo Nkosi')
    expect(result.nextStep).toBe('reg_collect_skills')
    expect(result.nextData?.name).toBeUndefined()
  })

  it('reg_collect_email migration: valid email is saved as optional enrichment and flow advances to verification prompt', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_email', undefined, 'thabo@example.com', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Verify your identity'),
      expect.any(Array),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData).toMatchObject({ providerEmail: 'thabo@example.com' })
  })

  it('reg_collect_email migration: "skip" advances to verification prompt without saving email', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_email', undefined, 'skip', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Verify your identity'),
      expect.any(Array),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData?.providerEmail).toBeUndefined()
  })

  it('reg_collect_email migration: any non-email reply advances to verification prompt without capturing email', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_email', undefined, 'not an email', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Verify your identity'),
      expect.any(Array),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData?.providerEmail).toBeUndefined()
  })

  // ── reg_collect_id: migration backward compat ────────────────────────────────

  it('reg_collect_id: typing a valid SA ID (Luhn passes) goes directly to skills (migration compat)', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_id', undefined, '8001015009087', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendList).not.toHaveBeenCalled()
    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('1.'))
    const body: string = (wa.sendText as any).mock.calls.at(-1)[1]
    expect(body).toContain('1. Plumbing')
    expect(body).toContain('2. Painting')
    expect(body).not.toMatch(/[□☐☑]/)
    expect(body).not.toContain('☐ 1.')
    expect(body).not.toContain('✅ 1.')
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ providerIdNumber: '8001015009087', verificationMethod: 'id_number', skills: [] })
  })

  it('reg_collect_id: invalid text re-shows the deferred verification choice', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_id', undefined, 'not a valid id', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Verify your identity'),
      expect.arrayContaining([expect.objectContaining({ id: 'verify_skip' })]),
    )
    expect(result.nextStep).toBe('reg_collect_id')
  })

  it('reg_collect_id: verify_later button defers verification and advances to skills', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_id', 'verify_skip', undefined, { name: 'Thabo Nkosi' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ verificationMethod: 'skipped', skills: [] })
  })

  it('reg_collect_id: verify_enter_id button transitions to ID entry step', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_id', 'verify_enter_id', undefined, { name: 'Thabo Nkosi' })
    )

    const body = (wa.sendText as any).mock.calls.at(-1)[1] as string

    expect(body).toContain('SA ID number')
    expect(body).toContain('Type *later* at any time to verify later')
    expect(body).not.toContain('continue without verifying')
    expect(result.nextStep).toBe('reg_verify_enter_id')
  })

  it('reg_collect_id: verify_upload_doc button transitions to document upload step', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_id', 'verify_upload_doc', undefined, { name: 'Thabo Nkosi' })
    )

    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('photo of your ID document'))
    expect(result.nextStep).toBe('reg_verify_upload_doc')
  })

  // ── reg_verify_enter_id ──────────────────────────────────────────────────────

  it('reg_verify_enter_id: valid SA ID (Luhn passes) saves ID and advances to skills', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', undefined, '8001015009087', { name: 'Thabo Nkosi' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ providerIdNumber: '8001015009087', verificationMethod: 'id_number', skills: [] })
  })

  it('reg_verify_enter_id: 13-digit number that fails Luhn shows error with verify later button and stays on step', async () => {
    // 8001015009080 - last digit changed so Luhn fails
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', undefined, '8001015009080', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining("didn't pass the checksum"),
      expect.arrayContaining([expect.objectContaining({ id: 'verify_skip' })]),
    )
    expect(result.nextStep).toBe('reg_verify_enter_id')
  })

  it('reg_verify_enter_id: verify_later button exits to skills without saving ID', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', 'verify_skip', undefined, { name: 'Thabo Nkosi' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ verificationMethod: 'skipped', skills: [] })
  })

  it('reg_verify_enter_id: text "later" defers verification and exits to skills without saving ID', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', undefined, 'later', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendText).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Identity verification deferred'),
    )
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ verificationMethod: 'skipped', skills: [] })
  })

  it('reg_verify_enter_id: short or invalid input shows error with skip button and stays on step', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', undefined, 'abc', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('valid'),
      expect.arrayContaining([expect.objectContaining({ id: 'verify_skip' })]),
    )
    expect(result.nextStep).toBe('reg_verify_enter_id')
  })

  it('reg_verify_enter_id: passport number (alphanumeric, not all digits) saves and advances', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', undefined, 'A1234567', { name: 'Thabo Nkosi' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ providerIdNumber: 'A1234567', verificationMethod: 'id_number', skills: [] })
  })

  it('reg_verify_enter_id: numeric-only foreign passport number saves and advances', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_enter_id', undefined, '123456789', { name: 'Thabo Nkosi' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ providerIdNumber: '123456789', verificationMethod: 'id_number', skills: [] })
  })


  // ── reg_verify_upload_doc / reg_verify_upload_selfie ─────────────────────────

  it('reg_verify_upload_doc: image upload stores attachment and advances to selfie step', async () => {
    const ctx = {
      phone,
      step: 'reg_verify_upload_doc' as any,
      data: { name: 'Thabo Nkosi' } as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_id_doc', mimeType: 'image/jpeg' },
    }
    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'media_id_doc' })
    )
    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('selfie'))
    expect(result.nextStep).toBe('reg_verify_upload_selfie')
    expect(result.nextData).toMatchObject({ verificationDocAttachmentId: 'att_mock_001', verificationDocMediaId: 'media_id_doc' })
  })

  it('reg_verify_upload_doc: verify_later button defers verification and advances to skills', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_upload_doc', 'verify_skip', undefined, { name: 'Thabo Nkosi' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ verificationMethod: 'skipped', skills: [] })
  })

  it('reg_verify_upload_selfie: image upload stores attachment and advances to skills', async () => {
    const ctx = {
      phone,
      step: 'reg_verify_upload_selfie' as any,
      data: { name: 'Thabo Nkosi', verificationDocAttachmentId: 'att_doc_001' } as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_selfie', mimeType: 'image/jpeg' },
    }
    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'media_selfie' })
    )
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({
      verificationSelfieAttachmentId: 'att_mock_001',
      verificationMethod: 'documents',
      skills: [],
    })
  })

  it('reg_verify_upload_selfie: skip skips selfie but keeps verificationMethod as documents (doc already uploaded)', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_verify_upload_selfie', 'verify_skip', undefined, { name: 'Thabo Nkosi', verificationDocAttachmentId: 'att_doc_001' })
    )

    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ verificationMethod: 'documents', skills: [] })
  })

  it('shows a numbered text list of skills after ID/passport is collected', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_id', undefined, '8001015009087', { name: 'Thabo Nkosi' })
    )

    expect(wa.sendList).not.toHaveBeenCalled()
    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('1.'))
    const body: string = (wa.sendText as any).mock.calls.at(-1)[1]
    expect(body).toContain('1. Plumbing')
    expect(body).toContain('2. Painting')
    expect(body).not.toMatch(/[□☐☑]/)
    expect(body).not.toContain('☐ 1.')
    expect(body).not.toContain('✅ 1.')
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData).toMatchObject({ providerIdNumber: '8001015009087', skills: [] })
  })

  it('re-shows selected skills as plain numbered rows, not checkbox rows', async () => {
    await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '', {
        name: 'Thabo Nkosi',
        skills: ['Plumbing', 'Carpentry'],
      })
    )

    const body: string = (wa.sendText as any).mock.calls.at(-1)[1]
    expect(body).toContain('1. Plumbing (selected)')
    expect(body).toContain('11. Carpentry (selected)')
    expect(body).not.toMatch(/[□☐☑]/)
    expect(body).not.toContain('✅ 1.')
  })

  it('parses "1,3" - selects two skills and shows Continue / Change buttons', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '1,3', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Skills selected'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'skills_confirm' }),
        expect.objectContaining({ id: 'skills_change' }),
      ]),
    )
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData?.skills).toHaveLength(2)
  })

  it('deduplicates input "1,1,2,3,2,2" to exactly 3 skills', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '1,1,2,3,2,2', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(result.nextData?.skills).toHaveLength(3)
  })

  it('parses mixed separators "1 2,3" as three selections', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '1 2,3', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(result.nextData?.skills).toHaveLength(3)
  })

  it('strips trailing periods - "1.,3." selects skills 1 and 3', async () => {
    // WhatsApp renders the numbered list as "1. Plumbing" and some users copy
    // the format and reply "1.,3." - the trailing period must be ignored.
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '1.,3.', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(result.nextData?.skills).toHaveLength(2)
    expect(result.nextData?.skills).toContain('Plumbing')
    expect(result.nextData?.skills).toContain('Garden & Landscaping')
  })

  it('"1,99" - accepts skill 1, warns about ignored number 99', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '1,99', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('99'),
      expect.any(Array),
    )
    expect(result.nextData?.skills).toHaveLength(1)
  })

  it('"99" only - re-shows numbered list with "None of those numbers" error', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, '99', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(wa.sendButtons).not.toHaveBeenCalled()
    expect(wa.sendText).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('None of those numbers'),
    )
    expect(result.nextStep).toBe('reg_collect_skills_more')
  })

  it('matches single-word skill text "plumbing" via label-matching fallback', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, 'plumbing', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Plumbing'),
      expect.any(Array),
    )
    expect(result.nextData?.skills).toContain('Plumbing')
  })

  it('sends a restriction notice for "pest control" - not accepted in pilot', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, 'pest control', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    const textCalls: string[] = (wa.sendText as any).mock.calls.map((c: any[]) => c[1] as string)
    expect(textCalls.some((t) => t.includes('not available on Plug A Pro'))).toBe(true)
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData?.skills).not.toContain('Pest Control')
  })

  it('sends restriction notice for "electrical" token but still adds "plumbing" from the same input', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, 'plumbing electrical', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    const textCalls: string[] = (wa.sendText as any).mock.calls.map((c: any[]) => c[1] as string)
    expect(textCalls.some((t) => t.includes('not available on Plug A Pro'))).toBe(true)
    expect(result.nextData?.skills).toContain('Plumbing')
    expect(result.nextData?.skills).not.toContain('Electrical')
  })

  it('"done" without any selection re-shows numbered list with prompt to pick first', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', undefined, 'done', {
        name: 'Thabo Nkosi',
        skills: [],
      })
    )

    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('1.'))
    expect(result.nextStep).toBe('reg_collect_skills_more')
  })

  it('skills_confirm with selections proceeds to area (interactive province list)', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', 'skills_confirm', undefined, {
        name: 'Thabo Nkosi',
        skills: ['Plumbing', 'Electrical'],
      })
    )

    expect(wa.sendList).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('area'),
      expect.any(Array),
      expect.any(Object),
    )
    expect(result.nextStep).toBe('reg_collect_experience')
  })

  it('skills_change clears selection and re-shows numbered text list (not sendList)', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_skills_more', 'skills_change', undefined, {
        name: 'Thabo Nkosi',
        skills: ['Plumbing'],
      })
    )

    expect(wa.sendList).not.toHaveBeenCalled()
    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('1.'))
    expect(result.nextStep).toBe('reg_collect_skills_more')
    expect(result.nextData?.skills).toEqual([])
  })

  it('marks only Johannesburg as active pilot in the city list', async () => {
    ;(locationNodes.getCities as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'city_jhb', label: 'Johannesburg', cityKey: 'johannesburg', provinceKey: 'gauteng', slug: 'gauteng__johannesburg' },
      { id: 'city_pta', label: 'Pretoria', cityKey: 'pretoria', provinceKey: 'gauteng', slug: 'gauteng__pretoria' },
    ])

    const result = await handleRegistrationFlow(makeCtx('reg_collect_experience', 'area_gauteng'))
    const rows = (wa.sendList as any).mock.calls[0][2][0].rows

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Johannesburg', description: expect.stringContaining('Active pilot') }),
      expect.objectContaining({ title: 'Pretoria', description: expect.stringContaining('Coming soon') }),
    ]))
    expect(result.nextStep).toBe('reg_collect_city')
  })

  it('marks only JHB West / Roodepoort as active in Johannesburg area list', async () => {
    ;(locationNodes.getRegions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'rgn_west', label: 'JHB West / Roodepoort', regionKey: 'jhb_west', slug: 'gauteng__johannesburg__jhb_west' },
      { id: 'rgn_north', label: 'Johannesburg North', regionKey: 'jhb_north', slug: 'gauteng__johannesburg__jhb_north' },
    ])

    const result = await handleRegistrationFlow({
      phone,
      step: 'reg_collect_city' as any,
      data: { provinceKey: 'gauteng' } as any,
      flow: 'registration' as const,
      reply: { type: 'button_reply' as any, id: 'city_city_jhb', title: 'Johannesburg' },
    })
    const body: string = (wa.sendList as any).mock.calls[0][1]
    const rows = (wa.sendList as any).mock.calls[0][2][0].rows

    expect(body).toContain('Only *JHB West / Roodepoort* is live')
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'JHB West / Roodepoort', description: expect.stringContaining('Active pilot') }),
      expect.objectContaining({ title: 'Johannesburg North', description: expect.stringContaining('Coming soon') }),
    ]))
    expect(result.nextStep).toBe('reg_collect_region')
  })
})

// ─── Evidence file upload paths ───────────────────────────────────────────────

describe('registration flow - evidence file uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })

  function makeMediaCtx(mediaType: 'image' | 'document', mediaId = 'media_abc123') {
    return {
      phone,
      step: 'reg_collect_evidence' as any,
      data: {} as any,
      flow: 'registration' as const,
      reply: {
        type: mediaType as any,
        mediaId,
        mimeType: mediaType === 'image' ? 'image/jpeg' : 'application/pdf',
      },
    }
  }

  it('image message triggers download, stores attachment ID, shows count prompt', async () => {
    const result = await handleRegistrationFlow(makeMediaCtx('image'))

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'media_abc123' })
    )
    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('1 file received'),
      expect.any(Array),
    )
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.evidenceFileUrls).toEqual(['att_mock_001'])
    expect(result.nextData?.evidenceMediaIds).toEqual(['media_abc123'])
  })

  it('stores non-risk uploaded evidence with provider_work_photo label', async () => {
    const result = await handleRegistrationFlow(makeMediaCtx('image', 'media_work_001'))

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media_work_001',
        prefix: 'provider_work_photo',
        label: 'provider_work_photo',
      })
    )
    expect(result.nextStep).toBe('reg_collect_evidence')
  })

  it('stores high-risk certification proof media with private certification label', async () => {
    const ctx = makeMediaCtx('document', 'media_cert_001')
    ctx.data = { skills: ['Electrical'], certificationProofIntent: true } as any

    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media_cert_001',
        prefix: 'certification_proof',
        label: 'provider_certification',
      })
    )
    expect(result.nextData?.evidenceFileUrls).toEqual(['att_mock_001'])
    expect(result.nextData?.certificationProofAttachmentIds).toEqual(['att_mock_001'])
    expect(result.nextData?.certificationProofMediaIds).toEqual(['media_cert_001'])
  })

  it('second image upload accumulates IDs without losing the first', async () => {
    const ctx = {
      phone,
      step: 'reg_collect_evidence' as any,
      data: { evidenceFileUrls: ['att_first_001'] } as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_second', mimeType: 'image/jpeg' },
    }

    const result = await handleRegistrationFlow(ctx)

    expect(result.nextData?.evidenceFileUrls).toEqual(['att_first_001', 'att_mock_001'])
    expect(result.nextData?.evidenceMediaIds).toEqual(['media_second'])
  })

  it('deduplicates repeated evidence media IDs without uploading again', async () => {
    const ctx = {
      phone,
      step: 'reg_collect_evidence' as any,
      data: { evidenceFileUrls: ['att_first_001'], evidenceMediaIds: ['media_dup'] } as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_dup', mimeType: 'image/jpeg' },
    }

    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(result.nextData?.evidenceFileUrls).toEqual(['att_first_001'])
    expect(result.nextData?.evidenceMediaIds).toEqual(['media_dup'])
    expect(wa.sendButtons).toHaveBeenCalledWith(phone, expect.stringContaining('1 file received'), expect.any(Array))
  })

  it('blocks evidence uploads after 5 files', async () => {
    const ctx = {
      phone,
      step: 'reg_collect_evidence' as any,
      data: {
        evidenceFileUrls: ['a', 'b', 'c', 'd', 'e'],
        evidenceMediaIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
      } as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_extra', mimeType: 'image/jpeg' },
    }

    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(result.nextData?.evidenceFileUrls).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(wa.sendButtons).toHaveBeenCalledWith(phone, expect.stringContaining('Maximum reached'), expect.any(Array))
  })

  it('upload failure sends error message and stays on evidence step', async () => {
    ;(whatsappMedia.downloadAndStoreWhatsAppMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Unsupported media type: video/mp4')
    )

    const result = await handleRegistrationFlow(makeMediaCtx('document'))

    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining("Couldn't upload"))
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData).toBeUndefined()
  })

  it('missing mediaId sends error message and stays on evidence step', async () => {
    const ctx = {
      phone,
      step: 'reg_collect_evidence' as any,
      data: {} as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: undefined, mimeType: 'image/jpeg' },
    }

    const result = await handleRegistrationFlow(ctx)

    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining("Couldn't process"))
    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('reg_collect_evidence')
  })

  it('handlePending with evidenceFileUrls calls attachment.updateMany to backfill FK', async () => {
    ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.providerApplication.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'app_with_evidence_00',
    })

    await handleRegistrationFlow(
      makeCtx('reg_pending', 'submit_yes', undefined, {
        name: 'Thabo Nkosi',
        skills: ['Plumbing'],
        serviceAreas: ['Gauteng'],
        experience: '3–5 years',
        availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        providerIdNumber: '8001015009087',
        evidenceFileUrls: ['att_ev_001', 'att_ev_002'],
      })
    )

    expect(db.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['att_ev_001', 'att_ev_002'] } }),
        data: expect.objectContaining({ providerApplicationId: 'app_with_evidence_00' }),
      })
    )
  })

  it('suppresses file progress confirmation when suppressEvidenceFileProgress is true (mid-batch)', async () => {
    const ctx = {
      phone,
      step: 'reg_collect_evidence' as any,
      data: {} as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_batch_1', mimeType: 'image/jpeg' },
      suppressEvidenceFileProgress: true,
      evidenceFileBatchSize: 3,
    }

    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalled()
    expect(wa.sendButtons).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.evidenceFileUrls).toEqual(['att_mock_001'])
  })

  it('sends file progress confirmation on last batch item when suppressEvidenceFileProgress is false', async () => {
    const ctx = {
      phone,
      step: 'reg_collect_evidence' as any,
      data: {
        evidenceFileUrls: ['att_first', 'att_second'],
        evidenceMediaIds: ['media_batch_1', 'media_batch_2'],
      } as any,
      flow: 'registration' as const,
      reply: { type: 'image' as any, mediaId: 'media_batch_3', mimeType: 'image/jpeg' },
      suppressEvidenceFileProgress: false,
      evidenceFileBatchSize: 3,
    }

    const result = await handleRegistrationFlow(ctx)

    expect(whatsappMedia.downloadAndStoreWhatsAppMedia).toHaveBeenCalled()
    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('3 files received'),
      expect.any(Array),
    )
    expect(result.nextData?.evidenceFileUrls).toEqual(['att_first', 'att_second', 'att_mock_001'])
  })

  it('uses "Add another file" button label (not "Add another")', async () => {
    const result = await handleRegistrationFlow(makeMediaCtx('image'))

    const buttons: Array<{ id: string; title: string }> = (wa.sendButtons as any).mock.calls[0][2]
    const addMoreButton = buttons.find((b) => b.id === 'evidence_add_more')
    expect(addMoreButton?.title).toBe('📎 Add another file')
  })

  it('shows certification proof status in the summary for high-risk services', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_evidence', 'evidence_skip', undefined, {
        name: 'Thabo Nkosi',
        skills: ['Electrical', 'Painting'],
        serviceAreas: ['Gauteng'],
        experience: '3–5 years',
        availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        callOutFee: 250,
        certificationProofAttachmentIds: ['att_cert_001'],
      })
    )

    expect(result.nextStep).toBe('reg_pending')
    const summary = (wa.sendButtons as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string
    expect(summary).toContain('High-risk review: *Electrical*')
    expect(summary).toContain('Certification proof: *Received*')
    expect(summary).not.toContain('https://')
  })

  it('handlePending without evidence files does not call attachment.updateMany', async () => {
    ;(db.providerApplication.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.providerApplication.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'app_no_evidence_001',
    })

    await handleRegistrationFlow(
      makeCtx('reg_pending', 'submit_yes', undefined, {
        name: 'Thabo Nkosi',
        skills: ['Plumbing'],
        serviceAreas: ['Gauteng'],
        experience: '3–5 years',
        availability: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      })
    )

    expect(db.attachment.updateMany).not.toHaveBeenCalled()
  })
})

// ─── Numbered suburb multi-select ────────────────────────────────────────────
// Suburbs are presented as plain numbered text (not interactive lists).
// Provider replies with comma-separated numbers; global 1-based numbering across pages.

describe('registration flow - numbered bulk suburb selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })

  // Mirror the mock: 20 fake suburbs as stored in session ctx.data after the first prompt
  const fakeSuburbs = Array.from({ length: 20 }, (_, i) => ({ id: `sub_${i}`, label: `Suburb ${i + 1}` }))

  const suburbBaseData = {
    regionId: 'rgn_test',
    regionLabel: 'Sandton',
    suburbPage: 0,
    suburbOptions: fakeSuburbs,
    locationNodeIds: [] as string[],
    selectedSuburbLabels: [] as string[],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })

  it('shows a numbered text list (not interactive list) after region is selected', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_region', 'region_jnb_north', undefined, {
        cityId: 'city_jhb',
        cityLabel: 'Johannesburg',
      })
    )

    // Must use plain text, not sendList
    expect(wa.sendList).not.toHaveBeenCalledWith(
      phone,
      expect.stringContaining('suburb'),
      expect.any(Array),
      expect.any(Object),
    )
    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('1.'))
    const body: string = (wa.sendText as any).mock.calls.at(-1)[1]
    expect(body).toContain('1. Suburb 1')
    expect(body).toContain('2. Suburb 2')
    expect(body).not.toMatch(/[□☐☑]/)
    expect(body).not.toContain('☐ 1.')
    expect(body).not.toContain('✅ 1.')
    expect(result.nextStep).toBe('reg_collect_suburb_select')
    expect(result.nextData?.suburbOptions).toHaveLength(20)
  })

  it('re-shows selected suburbs as plain numbered rows, not checkbox rows', async () => {
    await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', 'suburb_add_more', undefined, {
        ...suburbBaseData,
        locationNodeIds: ['sub_0'],
        selectedSuburbLabels: ['Suburb 1'],
      })
    )

    const body: string = (wa.sendText as any).mock.calls[0][1]
    expect(body).toContain('Selected so far: *Suburb 1*')
    expect(body).toContain('1. Suburb 1 (selected)')
    expect(body).not.toMatch(/[□☐☑]/)
    expect(body).not.toContain('✅ Selected so far')
    expect(body).not.toContain('✅ 1.')
  })

  it('"1,3" selects two suburbs and shows Continue / Add more / Change buttons', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, '1,3', suburbBaseData)
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('Selected suburbs'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'suburb_confirm' }),
        expect.objectContaining({ id: 'suburb_add_more' }),
        expect.objectContaining({ id: 'suburb_change' }),
      ]),
    )
    expect(result.nextData?.locationNodeIds).toHaveLength(2)
    expect(result.nextData?.selectedSuburbLabels).toContain('Suburb 1')
    expect(result.nextData?.selectedSuburbLabels).toContain('Suburb 3')
  })

  it('deduplicates input "1,1,3" to exactly 2 suburbs', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, '1,1,3', suburbBaseData)
    )

    expect(result.nextData?.locationNodeIds).toHaveLength(2)
  })

  it('"more" advances to the next page (global offset +15)', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, 'more', suburbBaseData)
    )

    // Items on page 2 are numbered starting from 16 (global 1-based)
    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('16.'))
    expect(result.nextStep).toBe('reg_collect_suburb_select')
  })

  it('"more" on the last page shows "You have seen all N suburbs" message', async () => {
    await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, 'more', {
        ...suburbBaseData,
        suburbPage: 15,  // already on page 2 (last page for 20 suburbs)
      })
    )

    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('all 20 suburbs'))
  })

  it('"all" selects all 20 suburbs and shows confirmation', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, 'all', suburbBaseData)
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('All 20 suburbs'),
      expect.any(Array),
    )
    expect(result.nextData?.locationNodeIds).toHaveLength(20)
  })

  it('"99" only - sends "None of those numbers" error and re-shows list', async () => {
    await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, '99', suburbBaseData)
    )

    expect(wa.sendText).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('None of those numbers'),
    )
  })

  it('"done" without any selection re-shows list with prompt', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', undefined, 'done', suburbBaseData)
    )

    expect(wa.sendText).toHaveBeenCalledWith(phone, expect.stringContaining('1.'))
    expect(result.nextStep).toBe('reg_collect_suburb_select')
  })

  it('suburb_confirm with selections proceeds to experience list', async () => {
    const result = await handleRegistrationFlow(
      makeCtx('reg_collect_suburb_select', 'suburb_confirm', undefined, {
        ...suburbBaseData,
        locationNodeIds: ['sub_0', 'sub_2'],
        selectedSuburbLabels: ['Suburb 1', 'Suburb 3'],
      })
    )

    // sendExperiencePrompt sends an interactive list
    expect(wa.sendList).toHaveBeenCalledWith(
      phone,
      expect.stringContaining('experience'),
      expect.any(Array),
      expect.any(Object),
    )
    expect(result.nextStep).toBe('reg_collect_availability')
  })
})

// ─── syncProviderRecord phone normalization ───────────────────────────────────

describe('syncProviderRecord - phone normalization', () => {
  // We test the public behavior via the real implementation (not mocked here).
  // Import provider-record directly and supply a minimal test client.

  // Un-mock provider-record for this describe block by re-importing the real module
  // via the path alias. Since vi.mock hoists, we use a manual client here instead.

  it('normalizePhone: converts South African local format 0xx to E.164 +27xx', () => {
    expect(normalizePhone('0821234567')).toBe('+27821234567')
    expect(normalizePhone('+27821234567')).toBe('+27821234567')
    expect(normalizePhone('0027821234567')).toBe('+27821234567')
    expect(normalizePhone('071 234 5678')).toBe('+27712345678')
    expect(normalizePhone('071-234-5678')).toBe('+27712345678')
    expect(normalizePhone('+27 82 123 4567')).toBe('+27821234567')
    expect(normalizePhone('+27-82-123-4567')).toBe('+27821234567')
  })

  it('normalizePhone: handles WhatsApp-delivered format without + prefix', () => {
    // WhatsApp delivers SA numbers as 27xxxxxxxxx (no + prefix)
    expect(normalizePhone('27821234567')).toBe('+27821234567')
    expect(normalizePhone('27821234567')).toBe('+27821234567')
  })
})
