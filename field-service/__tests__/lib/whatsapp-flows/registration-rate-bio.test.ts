import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

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
  it('skip via button id transitions to reg_collect_evidence', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      reply: { type: 'button_reply', id: 'provider_bio_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.providerBioSkipped).toBe(true)
    expect(result.nextData?.providerBio).toBeUndefined()
  })

  it('uses certification-specific proof prompt when high-risk services were selected', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      data: { skills: ['Electrical', 'Painting'] },
      reply: { type: 'button_reply', id: 'provider_bio_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.highRiskServiceLabels).toEqual(['Electrical'])
    expect(sendButtonsMock).toHaveBeenCalledWith(
      ctx.phone,
      expect.stringContaining('Selected high-risk services: *Electrical*'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'evidence_upload', title: '📎 Upload proof' }),
      ]),
    )
    const prompt = sendButtonsMock.mock.calls.at(-1)?.[1] as string
    expect(prompt).toContain('certificate, licence, trade qualification')
    expect(prompt).toContain('does not automatically mean Plug A Pro has verified it')
  })

  it('keeps generic proof prompt when only standard services were selected', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      data: { skills: ['Painting'] },
      reply: { type: 'button_reply', id: 'provider_bio_skip', title: '⏭️ Skip' },
    })
    await handleRegistrationFlow(ctx)
    const prompt = sendButtonsMock.mock.calls.at(-1)?.[1] as string
    expect(prompt).toContain('optional work note')
    expect(prompt).not.toContain('Selected high-risk services')
  })

  it('skip via free-text "skip" transitions to reg_collect_evidence', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ step: 'reg_collect_bio', reply: { type: 'text', text: 'skip' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.providerBioSkipped).toBe(true)
  })

  it('captures a typed bio and transitions to evidence', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      step: 'reg_collect_bio',
      reply: { type: 'text', text: '10 years fixing geysers and bathroom leaks. Always on time.' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_evidence')
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
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(result.nextData?.providerBio).toBe('A'.repeat(280))
  })

  it('empty input re-prompts and stays on bio step', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ step: 'reg_collect_bio', reply: { type: 'text', text: '   ' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_bio')
  })
})
