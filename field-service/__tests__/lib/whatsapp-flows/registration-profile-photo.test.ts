import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

// ─── Mocks (must match the registration.test.ts mock surface) ────────────────

vi.mock('@/lib/db', () => {
  const mockDb = {
    $transaction: vi.fn(),
    customer: { findFirst: vi.fn().mockResolvedValue(null) },
    providerApplication: { findFirst: vi.fn(), create: vi.fn() },
    provider: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
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

const downloadMock = vi.fn().mockResolvedValue({ attachmentId: 'att_profile_001' })
vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: downloadMock,
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    phone: '+27821234567',
    step: 'reg_collect_profile_photo',
    data: {},
    flow: 'registration',
    reply: { type: 'text' },
    ...overrides,
  } as FlowContext
}

beforeEach(() => {
  vi.clearAllMocks()
  downloadMock.mockResolvedValue({ attachmentId: 'att_profile_001' })
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('reg_collect_profile_photo step', () => {
  it('skip via button id transitions to reg_collect_bio and marks photo skipped', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      reply: { type: 'button_reply', id: 'profile_photo_skip', title: '⏭️ Skip' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_bio')
    expect(result.nextData?.profilePhotoSkipped).toBe(true)
    expect(result.nextData?.profilePhotoAttachmentId).toBeUndefined()
    // The "no photo for now" notice must have been sent.
    const allTexts = sendTextMock.mock.calls.map((args) => args[1] as string)
    expect(allTexts.some((t) => t.includes('No photo for now'))).toBe(true)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('skip via free-text "skip" transitions to reg_collect_bio', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'text', text: 'skip' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_bio')
    expect(result.nextData?.profilePhotoSkipped).toBe(true)
  })

  it('image upload stores attachment and transitions to reg_collect_bio', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      reply: { type: 'image', mediaId: 'media_xyz', mimeType: 'image/jpeg' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(downloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: 'media_xyz',
        prefix: 'profile_photo',
        label: 'provider_profile_photo',
      }),
    )
    expect(result.nextStep).toBe('reg_collect_bio')
    expect(result.nextData?.profilePhotoAttachmentId).toBe('att_profile_001')
    expect(result.nextData?.profilePhotoMediaId).toBe('media_xyz')
    expect(result.nextData?.profilePhotoSkipped).toBe(false)
  })

  it('duplicate media id is treated idempotently and does not re-upload', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      data: { profilePhotoMediaId: 'media_xyz', profilePhotoAttachmentId: 'att_profile_001' },
      reply: { type: 'image', mediaId: 'media_xyz', mimeType: 'image/jpeg' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(downloadMock).not.toHaveBeenCalled()
    expect(result.nextStep).toBe('reg_collect_bio')
  })

  it('upload failure re-prompts and keeps the user in the photo step', async () => {
    downloadMock.mockRejectedValueOnce(new Error('whatsapp-media down'))
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({
      reply: { type: 'image', mediaId: 'media_zzz', mimeType: 'image/jpeg' },
    })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(result.nextData?.profilePhotoAttachmentId).toBeUndefined()
    const errored = sendTextMock.mock.calls.some(
      (args) => typeof args[1] === 'string' && (args[1] as string).includes("Couldn't upload that photo"),
    )
    expect(errored).toBe(true)
  })

  it('non-image, non-skip free text re-prompts the photo step', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'text', text: 'hello' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('image without mediaId returns an error and keeps the step', async () => {
    const { handleRegistrationFlow } = await import('@/lib/whatsapp-flows/registration')
    const ctx = buildCtx({ reply: { type: 'image', mimeType: 'image/jpeg' } })
    const result = await handleRegistrationFlow(ctx)
    expect(result.nextStep).toBe('reg_collect_profile_photo')
    expect(downloadMock).not.toHaveBeenCalled()
  })
})
