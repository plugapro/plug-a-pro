import { vi, it, describe, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendText: vi.fn().mockResolvedValue({ messageId: 'wamid.test' }),
}))

import { db } from '@/lib/db'
import { recordAuditLog } from '@/lib/audit'

const mockBookingScheduled = {
  id: 'bk-1',
  status: 'SCHEDULED',
  scheduledDate: new Date('2026-06-01'),
  scheduledWindow: 'morning',
  match: {
    jobRequest: {
      category: 'plumbing',
      customer: { id: 'cust-1', phone: '+27820000001' },
    },
    provider: { id: 'prov-1', phone: '+27820000002' },
  },
  job: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestBookingReschedule', () => {
  it('happy path: returns booking when status is SCHEDULED', async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue(mockBookingScheduled as never)

    const { requestBookingReschedule } = await import('@/lib/bookings')
    const result = await requestBookingReschedule({
      bookingId: 'bk-1',
      actorId: 'user-1',
      actorRole: 'customer',
      reason: 'I have a conflicting appointment',
      requestedAvailability: 'Any weekday morning next week',
    })

    expect(result.id).toBe('bk-1')
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'booking.reschedule_request',
        entityType: 'booking',
        entityId: 'bk-1',
      })
    )
  })

  it('error path: throws when booking status is COMPLETED', async () => {
    vi.mocked(db.booking.findUnique).mockResolvedValue({
      ...mockBookingScheduled,
      status: 'COMPLETED',
    } as never)

    const { requestBookingReschedule } = await import('@/lib/bookings')
    await expect(
      requestBookingReschedule({
        bookingId: 'bk-1',
        actorId: 'user-1',
        actorRole: 'customer',
        reason: 'Testing error case',
        requestedAvailability: 'N/A',
      })
    ).rejects.toThrow('cannot be rescheduled from status COMPLETED')
  })
})
