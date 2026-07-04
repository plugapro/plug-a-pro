// When provider.onboarding.quality_gate_v2 is ON, the WhatsApp registration
// evidence step MUST NOT let the provider skip past or "done" past the photo
// requirement until ≥3 distinct evidence files are accumulated.
// The evidence_skip button is also suppressed in prompts when gate is ON.

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
    step: 'reg_collect_evidence',
    data: { name: 'Test Provider' },
    reply: { type: 'text', text: '' },
    ...overrides,
  }
}

beforeEach(() => {
  gateEnabled.mockReset().mockResolvedValue(true)
  mockSendText.mockReset().mockResolvedValue(undefined)
  mockSendButtons.mockClear()
  mockSendList.mockClear()
  mockSendCtaUrl.mockClear()
})

describe('WhatsApp evidence gate', () => {
  it('evidence_done with 2 photos stays on evidence + sends shortfall copy', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(mockSendText.mock.calls.flat().join(' ')).toContain('1 more')
  })

  it('evidence_skip is refused when gate ON', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_skip' },
      data: { evidenceFileUrls: ['a'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(mockSendText.mock.calls.flat().join(' ')).toContain('more')
  })

  it('evidence_done with 3 photos advances (to certification/summary)', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_pending')
  })
})
