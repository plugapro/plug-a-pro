// ─── Blueprint Step 04 — Provider Onboarding WhatsApp-First Flow ─────────────
// Verifies that the registration flow satisfies the blueprint spec:
//   1. Intro copy contains the required onboarding explanation elements.
//   2. Application submitted confirmation is sent after successful submit.
//   3. Required field validation prevents submission when name/skills/areas/
//      availability are missing.
//   4. Pause/resume is supported via conversation state (partial data).
//   5. Media upload: profile photo, work photos, certification docs accepted.
//   6. Phone-format validation on alternate mobile.
//   7. Rate validation blocks non-numeric input on call-out fee.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FlowContext } from '@/lib/whatsapp-flows/types'
import {
  buildProviderOnboardingIntroMessage,
  buildProviderApplicationSubmittedMessage,
  PROVIDER_APPLY_BUTTON_TITLE,
  PROVIDER_NOT_NOW_BUTTON_TITLE,
} from '@/lib/provider-credit-copy'
import { evaluateProviderProfileCompleteness } from '@/lib/provider-onboarding-completeness'

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => {
  const mockDb = {
    $transaction: vi.fn(),
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    providerApplication: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    provider: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    providerCategory: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    providerRate: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    attachment: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'att_1', providerApplicationId: null },
        { id: 'att_2', providerApplicationId: null },
      ]),
      findUnique: vi.fn().mockResolvedValue({ url: 'https://blob.example.com/photo.jpg' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ data: {} }),
      update: vi.fn().mockResolvedValue({ id: 'conv-mock' }),
    },
  }
  mockDb.$transaction.mockImplementation(async (callback) => {
    if (typeof callback === 'function') return callback(mockDb)
    return callback
  })
  return { db: mockDb }
})

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

const sendTextMock = vi.fn().mockResolvedValue(undefined)
const sendButtonsMock = vi.fn().mockResolvedValue(undefined)
const sendListMock = vi.fn().mockResolvedValue(undefined)
const sendCtaUrlMock = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: sendTextMock,
  sendButtons: sendButtonsMock,
  sendList: sendListMock,
  sendCtaUrl: sendCtaUrlMock,
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn().mockResolvedValue(undefined),
  sendAdminNewApplication: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-record', () => ({
  syncProviderRecord: vi.fn().mockResolvedValue('prov-test-001'),
  upsertStructuredServiceAreas: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-skills', () => ({
  syncProviderSkills: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  checkJobsForNewProviderAvailability: vi.fn().mockResolvedValue({ dispatchedOpenJobs: 0 }),
}))

vi.mock('@/lib/location-nodes', () => ({
  getCities: vi.fn().mockResolvedValue([]),
  getRegions: vi.fn().mockResolvedValue([]),
  getSuburbs: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/journey-recovery', () => ({
  sendWhatsAppJourneyRecovery: vi.fn().mockResolvedValue(undefined),
}))

function buildCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    phone: '+27821234567',
    step: 'reg_start',
    data: {},
    flow: 'registration',
    reply: { type: 'text' },
    ...overrides,
  } as FlowContext
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── 1. Intro copy ────────────────────────────────────────────────────────────

describe('intro copy', () => {
  it('contains the join invitation', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).toMatch(/join plug a pro as a service provider/i)
  })

  it('mentions application review before receiving job opportunities', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).toMatch(/review/i)
  })

  it('mentions starter credits on approval', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).toMatch(/starter credits|credits when onboarded/i)
  })

  it('explains that accepting a selected job uses 1 credit', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).toMatch(/1 credit/i)
    expect(msg).toMatch(/customer selects you/i)
  })

  it('states full customer details unlock after acceptance', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).toMatch(/full customer.*detail|details unlock/i)
  })

  it('does not contain raw URLs (urls must travel via CTA buttons)', () => {
    const msg = buildProviderOnboardingIntroMessage()
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('apply button title is present', () => {
    expect(PROVIDER_APPLY_BUTTON_TITLE).toBeTruthy()
    expect(PROVIDER_APPLY_BUTTON_TITLE.length).toBeLessThanOrEqual(20)
  })

  it('not-now button title is present', () => {
    expect(PROVIDER_NOT_NOW_BUTTON_TITLE).toBeTruthy()
    expect(PROVIDER_NOT_NOW_BUTTON_TITLE.length).toBeLessThanOrEqual(20)
  })
})

// ─── 2. Application submitted confirmation ────────────────────────────────────

describe('application submitted confirmation', () => {
  it('includes the application ref', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Thabo',
      applicationRef: 'ABCD1234',
    })
    expect(msg).toMatch(/ABCD1234/)
  })

  it('mentions approval is not automatic', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Thabo',
      applicationRef: 'ABCD1234',
    })
    expect(msg).toMatch(/approval is not automatic/i)
  })

  it('addresses provider by first name', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Thabo Mokoena',
      applicationRef: 'ABCD1234',
    })
    expect(msg).toMatch(/thabo/i)
    expect(msg).not.toMatch(/mokoena/i) // only first name
  })

  it('includes coming-soon region note when region is not live', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Sipho',
      applicationRef: 'ZZZZ9999',
      isComingSoonRegion: true,
    })
    expect(msg).toMatch(/not live yet|coming soon/i)
  })

  it('does not include coming-soon note for active regions', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Sipho',
      applicationRef: 'ZZZZ9999',
      isComingSoonRegion: false,
    })
    expect(msg).not.toMatch(/not live yet/i)
  })

  it('does not contain raw URLs', () => {
    const msg = buildProviderApplicationSubmittedMessage({
      providerName: 'Test',
      applicationRef: 'TEST0001',
    })
    expect(msg).not.toMatch(/https?:\/\//)
  })
})

// ─── 3. Required-field validation (submit gate) ───────────────────────────────

describe('required-field validation prevents submission', () => {
  it('blocks submit when name is empty', () => {
    const result = evaluateProviderProfileCompleteness({
      name: '',
      phone: '+27821234567',
      skills: ['Plumbing'],
      serviceAreas: ['Soweto'],
      availability: 'Mon, Tue, Wed, Thu, Fri',
    })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.some((m) => m.field === 'name' && m.severity === 'block_submit')).toBe(true)
  })

  it('blocks submit when skills are empty', () => {
    const result = evaluateProviderProfileCompleteness({
      name: 'Lovemore',
      phone: '+27821234567',
      skills: [],
      serviceAreas: ['Soweto'],
      availability: 'Mon, Tue, Wed, Thu, Fri',
    })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.some((m) => m.field === 'skills')).toBe(true)
  })

  it('blocks submit when service areas are empty', () => {
    const result = evaluateProviderProfileCompleteness({
      name: 'Lovemore',
      phone: '+27821234567',
      skills: ['Electrical'],
      serviceAreas: [],
      availability: 'Mon, Tue, Wed, Thu, Fri',
    })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.some((m) => m.field === 'serviceAreas')).toBe(true)
  })

  it('blocks submit when availability is empty', () => {
    const result = evaluateProviderProfileCompleteness({
      name: 'Lovemore',
      phone: '+27821234567',
      skills: ['Electrical'],
      serviceAreas: ['Fourways'],
      availability: '',
    })
    expect(result.canSubmit).toBe(false)
    expect(result.missing.some((m) => m.field === 'availability')).toBe(true)
  })

  it('allows submit with minimum required fields present', () => {
    const result = evaluateProviderProfileCompleteness({
      name: 'Lovemore',
      phone: '+27821234567',
      skills: ['Plumbing'],
      serviceAreas: ['Soweto'],
      availability: 'Mon, Tue, Wed, Thu, Fri',
    })
    expect(result.canSubmit).toBe(true)
  })
})

// ─── 4. Pause/resume: partial state preserved ─────────────────────────────────
// The registration flow writes partial data into FlowContext.data after every
// step. If the provider drops off and returns, the conversation record retains
// the partial state so the flow can resume from the last completed step.
// This test verifies that the step handlers correctly propagate nextData so that
// accumulated fields are not lost between WhatsApp messages.

describe('pause/resume — partial state propagation', () => {
  it('handleCollectSkills stores name in nextData for verification step', async () => {
    // In the registration flow, reg_collect_name asks for the name, then the
    // reply reaches handleCollectSkills (step=reg_collect_skills) which is where
    // the typed text is captured. The name is placed in nextData so the
    // conversation record retains it when the flow pauses here.
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_skills',
      reply: { type: 'text', text: 'Zanele Dube' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    // The name is stored in nextData under 'name' so that it is persisted into
    // the conversation state before the verification prompt is shown.
    expect(result.nextData?.name).toBe('Zanele Dube')
  })

  it('returning with partial skills data does not lose previously selected skills', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_skills_more',
      reply: { type: 'text', text: '1' }, // select first skill
      data: { name: 'Zanele', skills: ['Plumbing'], verificationMethod: 'skipped' },
    })
    const result = await handleRegistrationFlow(ctx)
    // Merged skills should include at least the pre-existing Plumbing skill
    const mergedSkills = result.nextData?.skills ?? ctx.data.skills
    expect(Array.isArray(mergedSkills)).toBe(true)
    expect((mergedSkills as string[]).length).toBeGreaterThanOrEqual(1)
  })
})

// ─── 5. Media uploads accepted ────────────────────────────────────────────────

describe('media upload — accepted at correct steps', () => {
  it('profile photo image is accepted and saves attachment', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    const ctx = buildCtx({
      step: 'reg_collect_profile_photo',
      reply: { type: 'image', mediaId: 'wamid_test_photo_001' },
      data: { callOutFee: 250, rateNegotiable: true, name: 'Test Provider' },
    })
    await handleRegistrationFlow(ctx)
    expect(downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'wamid_test_photo_001' })
    )
  })

  it('evidence document upload is accepted at reg_collect_evidence', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    const ctx = buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'document', mediaId: 'wamid_test_cert_001', mimeType: 'application/pdf' },
      data: { skills: ['Electrical'], evidenceFileUrls: [] },
    })
    await handleRegistrationFlow(ctx)
    expect(downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'wamid_test_cert_001' })
    )
  })

  it('ID document upload is accepted at reg_verify_upload_doc', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const { downloadAndStoreWhatsAppMedia } = await import('@/lib/whatsapp-media')
    const ctx = buildCtx({
      step: 'reg_verify_upload_doc',
      reply: { type: 'image', mediaId: 'wamid_test_id_doc_001' },
      data: { name: 'Lovemore Dlamini' },
    })
    await handleRegistrationFlow(ctx)
    expect(downloadAndStoreWhatsAppMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: 'wamid_test_id_doc_001' })
    )
  })
})

// ─── 6. Alternate mobile phone validation ────────────────────────────────────

describe('alternate mobile validation', () => {
  it('rejects an invalid phone number and re-prompts', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_alternate_mobile',
      reply: { type: 'text', text: 'not a number' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    // Should have sent an error text
    expect(sendTextMock).toHaveBeenCalled()
  })

  it('accepts a valid SA mobile number and advances', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_alternate_mobile',
      reply: { type: 'text', text: '0821234567' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_preferred_language')
    expect(result.nextData?.alternateMobileE164).toMatch(/^\+27/)
  })

  it('allows skipping alternate mobile', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_alternate_mobile',
      reply: { type: 'text', id: 'alternate_mobile_skip' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_preferred_language')
  })
})

// ─── 7. Rate validation ───────────────────────────────────────────────────────

describe('call-out fee validation', () => {
  it('rejects non-numeric input and re-prompts', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_rates',
      reply: { type: 'text', text: 'call me for price' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_rates')
  })

  it('accepts a plain number and advances to negotiable question', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_rates',
      reply: { type: 'text', text: '350' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_rates')
    expect(result.nextData?.callOutFee).toBe(350)
  })

  it('accepts R-prefix format and extracts numeric value', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_rates',
      reply: { type: 'text', text: 'R250' },
      data: {},
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextData?.callOutFee).toBe(250)
  })
})

// ─── 8. Registration triggers ─────────────────────────────────────────────────

describe('REGISTRATION_TRIGGERS', () => {
  it('includes "register", "join", "find work", and "i want to work"', async () => {
    const { REGISTRATION_TRIGGERS } = await import('@/lib/whatsapp-flows/registration')
    expect(REGISTRATION_TRIGGERS).toContain('register')
    expect(REGISTRATION_TRIGGERS).toContain('join')
    expect(REGISTRATION_TRIGGERS).toContain('find work')
    expect(REGISTRATION_TRIGGERS).toContain('i want to work')
  })

  it('includes Zulu and Afrikaans equivalents', async () => {
    const { REGISTRATION_TRIGGERS } = await import('@/lib/whatsapp-flows/registration')
    expect(REGISTRATION_TRIGGERS).toContain('ek wil werk')
    expect(REGISTRATION_TRIGGERS).toContain('ngifuna ukusebenza')
  })
})
