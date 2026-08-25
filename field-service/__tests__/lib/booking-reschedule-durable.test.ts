// CJ-06: reschedule requests must be durable, not a logged promise.
//
// The customer is told "our team will confirm shortly". These tests pin that:
//   - a durable RESCHEDULE_REQUEST ops-queue item is created even when
//     ADMIN_WHATSAPP_NUMBER is unset (the old path silently vanished),
//   - the provider is notified window-safely (freeform inside the 24h window;
//     an explicit FAILED MessageEvent outside it — never a doomed send),
//   - the best-effort admin ping behaviour is unchanged.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockRecordAuditLog, mockAdminSendText, mockInteractiveSendText, mockHasWindow } = vi.hoisted(() => ({
  mockDb: {
    booking: { findUnique: vi.fn() },
    messageEvent: { create: vi.fn() },
    opsQueueAssignment: { upsert: vi.fn() },
  },
  mockRecordAuditLog: vi.fn(),
  mockAdminSendText: vi.fn(),
  mockInteractiveSendText: vi.fn(),
  mockHasWindow: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mockRecordAuditLog }))
vi.mock('@/lib/whatsapp', () => ({ sendText: mockAdminSendText }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mockInteractiveSendText }))
vi.mock('@/lib/whatsapp-policy', () => ({ hasRecentInboundWhatsappSession: mockHasWindow }))

import { requestBookingReschedule } from '@/lib/bookings'

const BOOKING = {
  id: 'booking_12345678',
  status: 'SCHEDULED',
  scheduledDate: new Date('2026-07-08T08:00:00.000Z'),
  scheduledWindow: 'morning',
  match: {
    jobRequest: {
      id: 'jr_1',
      category: 'Plumbing',
      customer: { id: 'cust_1', name: 'Alice', phone: '+27820000001' },
    },
    provider: { id: 'prov_1', name: 'Bob', phone: '+27830000001' },
  },
  job: null,
}

const PARAMS = {
  bookingId: 'booking_12345678',
  actorId: 'cust_1',
  actorRole: 'customer' as const,
  reason: 'Work conflict',
  requestedAvailability: 'Saturday morning',
}

describe('requestBookingReschedule (CJ-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ADMIN_WHATSAPP_NUMBER
    mockDb.booking.findUnique.mockResolvedValue(BOOKING)
    mockDb.messageEvent.create.mockResolvedValue({})
    mockDb.opsQueueAssignment.upsert.mockResolvedValue({ id: 'q_1' })
    mockRecordAuditLog.mockResolvedValue(undefined)
    mockAdminSendText.mockResolvedValue('wamid.admin')
    mockInteractiveSendText.mockResolvedValue('wamid.provider')
    mockHasWindow.mockResolvedValue(true)
  })

  it('creates a durable RESCHEDULE_REQUEST ops-queue item even when ADMIN_WHATSAPP_NUMBER is unset', async () => {
    await requestBookingReschedule(PARAMS)

    expect(mockDb.opsQueueAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        queueType_entityId: { queueType: 'RESCHEDULE_REQUEST', entityId: 'booking_12345678' },
      },
      create: { queueType: 'RESCHEDULE_REQUEST', entityId: 'booking_12345678' },
    }))
    // No admin phone configured → no admin ping, but the durable record exists.
    expect(mockAdminSendText).not.toHaveBeenCalled()
  })

  it('never clobbers an existing claim: the upsert update clause is empty', async () => {
    await requestBookingReschedule(PARAMS)

    const upsertArgs = mockDb.opsQueueAssignment.upsert.mock.calls[0][0]
    expect(upsertArgs.update).toEqual({})
  })

  it('notifies the provider free-form when their 24h window is open', async () => {
    await requestBookingReschedule(PARAMS)

    expect(mockHasWindow).toHaveBeenCalledWith('+27830000001')
    expect(mockInteractiveSendText).toHaveBeenCalledWith(
      '+27830000001',
      expect.stringContaining('Reschedule requested'),
      expect.objectContaining({
        bookingId: 'booking_12345678',
        templateName: 'interactive:booking_reschedule_request_provider',
      }),
    )
    expect(mockInteractiveSendText.mock.calls[0][1]).toContain('Saturday morning')
    // Window-safe path never records a FAILED sentinel when it actually sends.
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })

  it('records an explicit FAILED MessageEvent (no doomed send) when the provider window is closed', async () => {
    mockHasWindow.mockResolvedValue(false)

    await requestBookingReschedule(PARAMS)

    expect(mockInteractiveSendText).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        to: '+27830000001',
        status: 'FAILED',
        failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
        bookingId: 'booking_12345678',
        providerId: 'prov_1',
      }),
    }))
    // The durable ops-queue item still carries the follow-up.
    expect(mockDb.opsQueueAssignment.upsert).toHaveBeenCalled()
  })

  it('keeps the admin ping when ADMIN_WHATSAPP_NUMBER is set', async () => {
    process.env.ADMIN_WHATSAPP_NUMBER = '+27840000001'

    await requestBookingReschedule(PARAMS)

    expect(mockAdminSendText).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27840000001',
      text: expect.stringContaining('Reschedule request received'),
    }))
  })

  it('survives an ops-queue write failure without breaking the customer flow (audit row already recorded)', async () => {
    mockDb.opsQueueAssignment.upsert.mockRejectedValue(new Error('db down'))

    const booking = await requestBookingReschedule(PARAMS)

    expect(booking.id).toBe('booking_12345678')
    expect(mockRecordAuditLog).toHaveBeenCalled()
  })

  it('still rejects bookings that cannot be rescheduled', async () => {
    mockDb.booking.findUnique.mockResolvedValue({ ...BOOKING, status: 'CANCELLED' })

    await expect(requestBookingReschedule(PARAMS)).rejects.toThrow('cannot be rescheduled')
    expect(mockDb.opsQueueAssignment.upsert).not.toHaveBeenCalled()
  })
})
