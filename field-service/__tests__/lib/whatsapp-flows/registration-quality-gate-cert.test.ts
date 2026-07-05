// Task 1.4: When provider.onboarding.quality_gate_v2 is ON and the applicant has
// a high-risk skill, the evidence step must route to reg_collect_certification
// instead of directly to the summary. Non-high-risk applicants skip straight to
// summary. The certification step accepts a typed reg number or a doc upload and
// re-prompts on empty text.

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
  downloadAndStoreWhatsAppMedia: vi.fn().mockResolvedValue({ attachmentId: 'att_cert_001' }),
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

describe('WhatsApp certification gate', () => {
  it('high-risk skill routes evidence-done → certification step', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_collect_certification')
  })

  it('non-high-risk skips certification (evidence-done → summary/pending)', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_pending')
  })

  it('certification step: typed registration number advances to summary', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_certification',
      reply: { type: 'text', text: 'PIRB-12345' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_pending')
    expect(result.nextData?.certificationRef).toBe('PIRB-12345')
  })

  it('certification step: empty input re-prompts, does not advance', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_certification',
      reply: { type: 'text', text: '   ' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_collect_certification')
  })

  it('certification step: cert document upload advances with attachment id', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_certification',
      reply: { type: 'image', mediaId: 'media-cert-1' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_pending')
    expect(result.nextData?.certificationDocAttachmentId).toBe('att_cert_001')
    expect(result.nextData?.certificationRef).toBe('attachment:att_cert_001')
  })

  it('evidence_skip with high-risk skill routes to certification and preserves evidenceNote', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_skip' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_collect_certification')
    expect(result.nextData?.evidenceNote).toBe('')
  })
})
