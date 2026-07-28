import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    customer: { findUnique: vi.fn() },
    messageEvent: { create: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

describe('outbound message event cohort guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.customer.findUnique.mockResolvedValue(null)
    mockDb.messageEvent.create.mockResolvedValue({})
  })

  it('allows test WhatsApp notifications to internal test numbers', async () => {
    const { logOutboundMessage } = await import('@/lib/message-events')

    await logOutboundMessage({
      to: '+27000000001',
      templateName: 'test-template',
      body: 'Internal test',
      metadata: { isTestRequest: true, traceId: 'trace-1' },
    })

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: '+27000000001',
        status: 'SENT',
        isTestEvent: true,
        cohortName: 'internal_staff_test',
      }),
      select: { id: true },
    })
  })

  it('blocks test WhatsApp notifications to live numbers', async () => {
    const { logOutboundMessage } = await import('@/lib/message-events')

    await expect(logOutboundMessage({
      to: '+27821234567',
      templateName: 'test-template',
      body: 'Internal test',
      metadata: { isTestRequest: true, traceId: 'trace-2' },
    })).rejects.toThrow('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: '+27821234567',
        status: 'FAILED',
        failureReason: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
        isTestEvent: true,
        cohortName: 'internal_staff_test',
      }),
    })
  })

  it('blocks live WhatsApp notifications to internal test numbers when the subject is explicitly live', async () => {
    const { logOutboundMessage } = await import('@/lib/message-events')

    await expect(logOutboundMessage({
      to: '+27000000001',
      templateName: 'live-template',
      body: 'Live job',
      metadata: { isTestRequest: false, traceId: 'trace-3' },
    })).rejects.toThrow('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: '+27000000001',
        status: 'FAILED',
        failureReason: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
        isTestEvent: false,
      }),
    })
  })

  it('returns the created MessageEvent id so callers can mark it failed later', async () => {
    mockDb.messageEvent.create.mockResolvedValue({ id: 'evt-123' })
    const { logOutboundMessage } = await import('@/lib/message-events')

    const result = await logOutboundMessage({
      to: '+27773923802',
      templateName: 'test-template',
      body: 'Internal test',
      metadata: { isTestRequest: true, traceId: 'trace-ret' },
    })

    expect(result).toEqual({ id: 'evt-123' })
  })

  it('records the explicit DB recipient test flag on blocked sends', async () => {
    const { logOutboundMessage } = await import('@/lib/message-events')

    await expect(logOutboundMessage({
      to: '+27821234567',
      templateName: 'test-template',
      body: 'Internal test',
      metadata: { isTestRequest: true, recipientIsTest: false, traceId: 'trace-4' },
    })).rejects.toThrow('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'FAILED',
        metadata: expect.objectContaining({
          recipientIsTest: false,
          recipientIsTestUser: false,
          blockedReason: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
        }),
      }),
    })
  })
})

describe('markOutboundMessageFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.messageEvent.update.mockResolvedValue({})
  })

  it('marks the event FAILED with the failure reason', async () => {
    const { markOutboundMessageFailed } = await import('@/lib/message-events')

    await markOutboundMessageFailed({ eventId: 'evt-123', failureReason: 'meta 500' })

    expect(mockDb.messageEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-123' },
      data: { status: 'FAILED', failureReason: 'meta 500' },
    })
  })
})
