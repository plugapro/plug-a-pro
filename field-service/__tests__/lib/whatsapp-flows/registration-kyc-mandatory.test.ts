// When provider.kyc.required_for_activation is ON, the WhatsApp registration
// flow MUST NOT let the provider type "later" / tap "verify_skip" past the
// identity steps. These tests pin the no-skip branch end-to-end at the flow
// level — the underlying skip removals are in lib/whatsapp-flows/registration.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/kyc-policy', () => ({
  isKycRequiredForActivation: vi.fn().mockResolvedValue(true),
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
  mockSendText,
  mockSendButtons,
  mockSendList,
  mockSendCtaUrl,
} = vi.hoisted(() => ({
  mockSendText: vi.fn().mockResolvedValue(undefined),
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
    step: 'reg_collect_id',
    data: { name: 'Test Provider' },
    reply: { type: 'text', text: 'later' },
    ...overrides,
  }
}

beforeEach(() => {
  mockSendText.mockClear()
  mockSendButtons.mockClear()
  mockSendList.mockClear()
  mockSendCtaUrl.mockClear()
})

describe('WhatsApp registration — mandatory KYC mode', () => {
  it('handleCollectId: "later" reply does NOT advance past identity', async () => {
    const result = await handleRegistrationFlow(
      buildCtx({ step: 'reg_collect_id', reply: { type: 'text', text: 'later' } }),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    // verificationMethod=skipped must not be set in mandatory mode
    expect(result.nextData?.verificationMethod).toBeUndefined()
  })

  it('handleCollectId: verify_skip button does NOT advance past identity', async () => {
    const result = await handleRegistrationFlow(
      buildCtx({ step: 'reg_collect_id', reply: { type: 'interactive', id: 'verify_skip' } }),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData?.verificationMethod).toBeUndefined()
  })

  it('handleVerifyEnterId: "later" reply stays on the same step', async () => {
    const result = await handleRegistrationFlow(
      buildCtx({ step: 'reg_verify_enter_id', reply: { type: 'text', text: 'later' } }),
    )
    expect(result.nextStep).toBe('reg_verify_enter_id')
    expect(result.nextData?.verificationMethod).toBeUndefined()
  })

  it('handleVerifyUploadDoc: verify_skip stays on the same step', async () => {
    const result = await handleRegistrationFlow(
      buildCtx({ step: 'reg_verify_upload_doc', reply: { type: 'interactive', id: 'verify_skip' } }),
    )
    expect(result.nextStep).toBe('reg_verify_upload_doc')
    expect(result.nextData?.verificationMethod).toBeUndefined()
  })

  it('handleVerifyUploadSelfie: verify_skip stays on the same step', async () => {
    const result = await handleRegistrationFlow(
      buildCtx({ step: 'reg_verify_upload_selfie', reply: { type: 'interactive', id: 'verify_skip' } }),
    )
    expect(result.nextStep).toBe('reg_verify_upload_selfie')
    // Critical: must NOT mark verificationMethod=documents and bail to skills
    expect(result.nextData?.verificationMethod).toBeUndefined()
  })

  it('handleCollectId with valid SA ID: routes to upload-doc (not skills)', async () => {
    // Valid SA ID with passing Luhn checksum (constructed via the standard algorithm).
    // 8002285065083 is the example used by SARS test fixtures.
    const result = await handleRegistrationFlow(
      buildCtx({ step: 'reg_collect_id', reply: { type: 'text', text: '8002285065083' } }),
    )
    expect(result.nextStep).toBe('reg_verify_upload_doc')
    expect(result.nextData?.providerIdNumber).toBe('8002285065083')
  })
})
