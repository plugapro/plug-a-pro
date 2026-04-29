import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    customer: { findUnique: vi.fn() },
    messageEvent: { create: vi.fn() },
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
      to: '+27823035070',
      templateName: 'test-template',
      body: 'Internal test',
      metadata: { isTestRequest: true, traceId: 'trace-1' },
    })

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: '+27823035070',
        status: 'SENT',
        isTestEvent: true,
        cohortName: 'internal_staff_test',
      }),
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
      to: '+27773923802',
      templateName: 'live-template',
      body: 'Live job',
      metadata: { isTestRequest: false, traceId: 'trace-3' },
    })).rejects.toThrow('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')

    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: '+27773923802',
        status: 'FAILED',
        failureReason: 'NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH',
        isTestEvent: false,
      }),
    })
  })
})
