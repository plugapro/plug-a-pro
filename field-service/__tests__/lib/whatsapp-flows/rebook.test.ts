// ─── WA rebook keyword handler - handleRebookFlow ────────────────────────────
// Covers:
//  1. Customer with a completed job → sends rebook confirmation buttons
//  2. Customer with no completed jobs → sends "no jobs" message
//  3. Customer not found (no customer record) → sends "no jobs" message
//  4. Correct Prisma query shape (status COMPLETED + customer id filter)
//  5. Uses category as label when title is null

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
// vi.mock() calls are hoisted - use vi.hoisted() for shared state.

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(),
    customer: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    job: {
      findFirst: vi.fn(),
    },
    jobRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ data: {} }),
      upsert: vi.fn().mockResolvedValue({
        id: 'conv-1',
        phone: '+27821234567',
        flow: 'idle',
        step: 'welcome',
        data: {},
        expiresAt: new Date(Date.now() + 60_000),
      }),
      update: vi.fn().mockResolvedValue({ id: 'conv-mock' }),
    },
    attachment: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  mockDb.$transaction.mockImplementation(async (callback: any) => {
    if (typeof callback === 'function') return callback(mockDb)
    return callback
  })
  return { mockDb }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('msg-text'),
  sendButtons: vi.fn().mockResolvedValue('msg-btns'),
  sendList: vi.fn().mockResolvedValue('msg-list'),
  sendCtaUrl: vi.fn().mockResolvedValue('msg-cta'),
  parseInbound: vi.fn(),
}))

vi.mock('@/lib/whatsapp-identity', () => ({
  resolveWhatsAppUserContext: vi.fn(),
  phoneLookupVariants: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/location-nodes', () => ({
  getProvinces: vi.fn(),
  getCities: vi.fn(),
  getRegions: vi.fn(),
  getSuburbs: vi.fn(),
  getStructuredAddressSelection: vi.fn(),
}))

vi.mock('@/lib/service-area-guard', () => ({
  isInActiveServiceArea: vi.fn(),
  isActiveProvince: vi.fn().mockReturnValue(true),
  isActiveCity: vi.fn().mockReturnValue(true),
  isActiveRegion: vi.fn().mockReturnValue(true),
  addToServiceAreaWaitlist: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/structured-address', () => ({
  resolveStructuredAddressCapture: vi.fn(),
  InvalidStructuredAddressError: class InvalidStructuredAddressError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'InvalidStructuredAddressError'
    }
  },
}))

vi.mock('@/lib/job-requests/create-job-request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/job-requests/create-job-request')>()
  return {
    ...actual,
    createJobRequest: vi.fn(),
  }
})

vi.mock('@/lib/category-config', () => ({
  resolveCategoryRequirements: vi.fn().mockResolvedValue({
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    policy: { bookingOnAssignment: false, regulated: false },
  }),
}))

vi.mock('@/lib/whatsapp-media', () => ({
  downloadAndStoreWhatsAppMedia: vi.fn(),
}))

vi.mock('@/lib/whatsapp-media-batch', () => ({
  debounceMediaBatch: vi.fn().mockResolvedValue({ mySeq: 1, isLatest: true }),
  readMediaBatchSeq: vi.fn().mockResolvedValue(1),
  claimMediaBatchSeq: vi.fn().mockResolvedValue(1),
  awaitAndCheckLatest: vi.fn().mockResolvedValue(true),
  WHATSAPP_MEDIA_BATCH_DEBOUNCE_MS: 0,
}))

import { handleRebookFlow } from '@/lib/whatsapp-flows/job-request'
import * as wa from '@/lib/whatsapp-interactive'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PHONE = '+27821234567'

const COMPLETED_JOB_ROW = {
  booking: {
    match: {
      jobRequest: {
        id: 'jr-abc123',
        category: 'Plumbing',
        title: 'Fix kitchen tap',
        description: 'Kitchen tap is dripping',
      },
    },
  },
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleRebookFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends confirmation buttons when customer has a completed job', async () => {
    mockDb.customer.findFirst.mockResolvedValue({ id: 'cust-1' })
    mockDb.job.findFirst.mockResolvedValue(COMPLETED_JOB_ROW)

    await handleRebookFlow(PHONE)

    expect(wa.sendButtons).toHaveBeenCalledOnce()
    const [toPhone, body, buttons] = vi.mocked(wa.sendButtons).mock.calls[0]
    expect(toPhone).toBe(PHONE)
    expect(body).toContain('Fix kitchen tap')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].id).toBe('rebook_confirm:jr-abc123')
    expect(buttons[0].title).toBe('Yes, book again')
    expect(buttons[1].id).toBe('rebook_cancel')
    expect(wa.sendText).not.toHaveBeenCalled()
  })

  it('uses category as label when title is null', async () => {
    mockDb.customer.findFirst.mockResolvedValue({ id: 'cust-1' })
    mockDb.job.findFirst.mockResolvedValue({
      booking: {
        match: {
          jobRequest: {
            id: 'jr-xyz456',
            category: 'Electrical',
            title: null,
            description: 'Install a new socket',
          },
        },
      },
    })

    await handleRebookFlow(PHONE)

    const [, body] = vi.mocked(wa.sendButtons).mock.calls[0]
    expect(body).toContain('Electrical')
  })

  it('sends no-jobs message when customer has no completed jobs', async () => {
    mockDb.customer.findFirst.mockResolvedValue({ id: 'cust-1' })
    mockDb.job.findFirst.mockResolvedValue(null)

    await handleRebookFlow(PHONE)

    expect(wa.sendText).toHaveBeenCalledOnce()
    const [toPhone, msg] = vi.mocked(wa.sendText).mock.calls[0]
    expect(toPhone).toBe(PHONE)
    expect(msg).toContain("don't have any completed jobs")
    expect(wa.sendButtons).not.toHaveBeenCalled()
  })

  it('sends no-jobs message when no customer record exists', async () => {
    mockDb.customer.findFirst.mockResolvedValue(null)

    await handleRebookFlow(PHONE)

    expect(wa.sendText).toHaveBeenCalledOnce()
    const [, msg] = vi.mocked(wa.sendText).mock.calls[0]
    expect(msg).toContain("don't have any completed jobs")
    expect(wa.sendButtons).not.toHaveBeenCalled()
    // db.job.findFirst should not have been called since customer was null
    expect(mockDb.job.findFirst).not.toHaveBeenCalled()
  })

  it('queries db.job with COMPLETED status and customer id filter', async () => {
    mockDb.customer.findFirst.mockResolvedValue({ id: 'cust-42' })
    mockDb.job.findFirst.mockResolvedValue(null)

    await handleRebookFlow(PHONE)

    expect(mockDb.job.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'COMPLETED',
          booking: expect.objectContaining({
            match: expect.objectContaining({
              jobRequest: expect.objectContaining({
                customerId: 'cust-42',
              }),
            }),
          }),
        }),
      })
    )
  })
})
