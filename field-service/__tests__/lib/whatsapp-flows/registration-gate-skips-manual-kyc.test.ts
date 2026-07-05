// Task 2.7: When provider.onboarding.quality_gate_v2 is ON, the name step must
// route directly to reg_collect_skills_more (skipping reg_collect_id and the
// entire manual reg_verify_* path). Gate OFF: unchanged — reg_collect_id as today.

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

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    providerApplication: { findFirst: vi.fn(), create: vi.fn() },
    provider: { findUnique: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
    providerCategory: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    providerRate: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    attachment: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ data: {} }),
      update: vi.fn().mockResolvedValue({ id: 'conv-mock' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
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

import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'

function buildCtx(overrides: any = {}) {
  return {
    phone: '+27821234567',
    flow: 'registration',
    step: 'reg_collect_skills',
    data: {},
    reply: { type: 'text', text: 'John Smith' },
    ...overrides,
  }
}

beforeEach(() => {
  gateEnabled.mockReset().mockResolvedValue(false)
  mockSendText.mockReset().mockResolvedValue(undefined)
  mockSendButtons.mockClear()
  mockSendList.mockClear()
  mockSendCtaUrl.mockClear()
})

describe('Task 2.7 — gate ON skips manual KYC path after name', () => {
  it('gate ON: valid name → nextStep is reg_collect_skills_more (not reg_collect_id)', async () => {
    gateEnabled.mockResolvedValue(true)
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_skills',
      reply: { type: 'text', text: 'John Smith' },
      data: {},
    }))
    expect(result.nextStep).toBe('reg_collect_skills_more')
  })

  it('gate ON: valid name → sendVerificationChoicePrompt (sendButtons with verify_enter_id) is NOT called', async () => {
    gateEnabled.mockResolvedValue(true)
    await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_skills',
      reply: { type: 'text', text: 'John Smith' },
      data: {},
    }))
    // sendVerificationChoicePrompt always calls sendButtons(phone, body, buttons);
    // verify it was NOT called with a verify_enter_id button (identity choice prompt)
    const verifyButtonCalls = mockSendButtons.mock.calls.filter((args: any[]) =>
      Array.isArray(args[2]) && args[2].some((b: any) => b.id === 'verify_enter_id')
    )
    expect(verifyButtonCalls).toHaveLength(0)
  })

  it('gate ON: name_use_wa shortcut → nextStep is reg_collect_skills_more (not reg_collect_id)', async () => {
    gateEnabled.mockResolvedValue(true)
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_skills',
      reply: { type: 'interactive', id: 'name_use_wa' },
      data: { proposedName: 'Jane Doe' },
    }))
    expect(result.nextStep).toBe('reg_collect_skills_more')
  })

  it('gate OFF: valid name → nextStep is reg_collect_id (existing behaviour)', async () => {
    gateEnabled.mockResolvedValue(false)
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_skills',
      reply: { type: 'text', text: 'John Smith' },
      data: {},
    }))
    expect(result.nextStep).toBe('reg_collect_id')
  })

  it('gate OFF: sendVerificationChoicePrompt (sendButtons with verify_enter_id) IS called', async () => {
    gateEnabled.mockResolvedValue(false)
    await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_skills',
      reply: { type: 'text', text: 'John Smith' },
      data: {},
    }))
    const verifyButtonCalls = mockSendButtons.mock.calls.filter((args: any[]) =>
      Array.isArray(args[2]) && args[2].some((b: any) => b.id === 'verify_enter_id')
    )
    expect(verifyButtonCalls.length).toBeGreaterThan(0)
  })

  it('gate ON: migrated email step → nextStep is reg_collect_skills_more (not reg_collect_id)', async () => {
    gateEnabled.mockResolvedValue(true)
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_email',
      reply: { type: 'text', text: 'test@example.com' },
      data: {},
    }))
    expect(result.nextStep).toBe('reg_collect_skills_more')
  })

  it('gate OFF: migrated email step → nextStep is reg_collect_id', async () => {
    gateEnabled.mockResolvedValue(false)
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_email',
      reply: { type: 'text', text: 'test@example.com' },
      data: {},
    }))
    expect(result.nextStep).toBe('reg_collect_id')
  })
})
