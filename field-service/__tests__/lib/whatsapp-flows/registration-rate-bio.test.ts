import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

// Heavy dynamic imports under full-suite parallel load can exceed the
// default 5s testTimeout. Bump per-file (validated 2026-06-08).
vi.setConfig({ testTimeout: 15_000 })

// Mocks mirror the surface from registration-profile-photo.test.ts so the new
// optional steps (Phase 4 follow-up Tasks 1 + 2) can be exercised in isolation.

vi.mock('@/lib/db', () => {
  const mockDb = {
    $transaction: vi.fn(),
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    providerApplication: { findFirst: vi.fn(), create: vi.fn() },
    provider: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    attachment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
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
  syncProviderRecord: vi.fn().mockResolvedValue('prov-mock'),
  upsertStructuredServiceAreas: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp-media-batch', () => ({
  debounceMediaBatch: vi.fn().mockResolvedValue({ mySeq: 1, isLatest: true }),
  readMediaBatchSeq: vi.fn().mockResolvedValue(1),
  claimMediaBatchSeq: vi.fn().mockResolvedValue(1),
  awaitAndCheckLatest: vi.fn().mockResolvedValue(true),
  WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS: 0,
}))

function buildCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    phone: '+27821234567',
    step: 'reg_collect_hourly_rate',
    data: { callOutFee: 250, rateNegotiable: true },
    flow: 'registration',
    reply: { type: 'text' },
    ...overrides,
  } as FlowContext
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Task 1: hourly rate ────────────────────────────────────────────────────

describe('reg_collect_hourly_rate step (Phase 4 follow-up Task 1)', () => {
  it('skip via button id transitions to reg_collect_profile_photo', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      reply: { type: 'button_reply', id: 'hourly_rate_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(result.nextData?.hourlyRateSkipped).toBe(true)
    expect(result.nextData?.hourlyRate).toBeUndefined()
  })

  it('skip via free-text "skip" transitions to reg_collect_profile_photo', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'text', text: 'skip' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(result.nextData?.hourlyRateSkipped).toBe(true)
  })

  it('captures a numeric hourly rate and transitions to profile photo', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'text', text: '350' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(result.nextData?.hourlyRate).toBe(350)
    expect(result.nextData?.hourlyRateSkipped).toBe(false)
  })

  it('accepts "R250" format', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'text', text: 'R250' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(result.nextData?.hourlyRate).toBe(250)
  })

  it('rejects unparseable input and re-prompts', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'text', text: 'not a number' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_hourly_rate')
    expect(result.nextData?.hourlyRate).toBeUndefined()
  })
})

// ─── Task 2: bio ────────────────────────────────────────────────────────────

describe('reg_collect_bio step (Phase 4 follow-up Task 2)', () => {
  it('skip via button id transitions to reg_collect_alternate_mobile', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      reply: { type: 'button_reply', id: 'provider_bio_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    expect(result.nextData?.providerBioSkipped).toBe(true)
    expect(result.nextData?.providerBio).toBeUndefined()
  })

  it('transitions to reg_collect_alternate_mobile when high-risk services were selected (labels computed at evidence step)', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      data: { skills: ['Electrical', 'Painting'] },
      reply: { type: 'button_reply', id: 'provider_bio_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    expect(sendButtonsMock).toHaveBeenCalledWith(
      ctx.phone,
      expect.stringContaining('add an alternate mobile'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'alternate_mobile_skip' }),
      ]),
    )
    // highRiskServiceLabels is computed in promptEvidenceAfterBio (called from
    // reg_collect_reference2), not at the bio step. Skills are preserved in ctx.data.
  })

  it('keeps generic proof prompt when only standard services were selected', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      data: { skills: ['Painting'] },
      reply: { type: 'button_reply', id: 'provider_bio_skip', title: '⏭️ Skip' },
    })
    await handleRegistrationFlow(ctx)
    expect((sendButtonsMock.mock.calls.at(-1)?.[1] as string)).toContain('alternate mobile')
    const prompt = sendButtonsMock.mock.calls.at(-1)?.[1] as string
    expect(prompt).toContain('alternate mobile')
    expect(prompt).not.toContain('Selected high-risk services')
  })

  it('skip via free-text "skip" transitions to reg_collect_alternate_mobile', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ step: 'reg_collect_bio', reply: { type: 'text', text: 'skip' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    expect(result.nextData?.providerBioSkipped).toBe(true)
  })

  it('captures a typed bio and transitions to reg_collect_alternate_mobile', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      reply: { type: 'text', text: '10 years fixing geysers and bathroom leaks. Always on time.' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    expect(result.nextData?.providerBio).toBe('10 years fixing geysers and bathroom leaks. Always on time.')
    expect(result.nextData?.providerBioSkipped).toBe(false)
  })

  it('truncates bio over 280 characters', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const longBio = 'A'.repeat(400)
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      reply: { type: 'text', text: longBio },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    expect(result.nextData?.providerBio).toBe('A'.repeat(280))
  })

  it('empty input re-prompts and stays on bio step', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ step: 'reg_collect_bio', reply: { type: 'text', text: '   ' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_bio')
  })
})

describe('reg_collect_alternate_mobile step (Task 5)', () => {
  it('accepts a valid alternate mobile and normalizes to E.164', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_alternate_mobile',
      data: { providerBio: 'Bio text' },
      reply: { type: 'text', text: '082 123 4567' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_preferred_language')
    expect(result.nextData?.alternateMobileE164).toBe('+27821234567')
  })

  it('re-prompts on invalid alternate mobile format', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_alternate_mobile',
      reply: { type: 'text', text: '12345' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_alternate_mobile')
    expect(sendTextMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Enter a valid South African mobile number'),
    )
    expect(result.nextData).toBeUndefined()
  })

  it('skip button forwards to preferred language step', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_alternate_mobile',
      reply: { type: 'button_reply', id: 'alternate_mobile_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_preferred_language')
  })
})

describe('reg_collect_preferred_language step', () => {
  it('accepts a language button and forwards to reference 1 prompt', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_preferred_language',
      reply: { type: 'button_reply', id: 'preferred_language_english', title: 'English' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_reference1')
    expect(result.nextData?.preferredLanguage).toBe('English')
  })

  it('allows custom language text and forwards to reference 1 prompt', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_preferred_language',
      reply: { type: 'text', text: 'Afrikaans' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_reference1')
    expect(result.nextData?.preferredLanguage).toBe('Afrikaans')
  })
})

describe('reg_collect_reference steps (Task 5)', () => {
  it('parses and stores reference 1 when sent as Name, Phone', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_reference1',
      reply: { type: 'text', text: 'Sipho Mokoena, 082 555 1234' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_reference2')
    expect(result.nextData?.reference1Name).toBe('Sipho Mokoena')
    expect(result.nextData?.reference1Mobile).toBe('+27825551234')
  })

  it('prompts again when reference input has no phone number', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_reference1',
      reply: { type: 'text', text: 'Sipho Mokoena' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_reference1')
    expect(sendTextMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Please send Reference 1 as: Name, Phone number'),
    )
  })

  it('stores reference 2 and then transitions to evidence flow', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_reference2',
      data: { reference1Name: 'Sipho Mokoena', reference1Mobile: '+27825551234' },
      reply: { type: 'text', text: 'Lerato Dlamini, 078 999 2222' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.reference2Name).toBe('Lerato Dlamini')
    expect(result.nextData?.reference2Mobile).toBe('+27789992222')
  })
})
