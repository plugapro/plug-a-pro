// CJ-05: WhatsApp cancel must reach bookings.
//
// Pins the routing decision: a customer with a confirmed Booking
// (SCHEDULED/RESCHEDULED, non-terminal job) routes to the booking-lifecycle
// cancel; otherwise the legacy JobRequest cancel applies. Customer lookup uses
// phoneLookupVariants (CJ-15 pattern) so legacy-format phone rows resolve.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    customer: { findFirst: vi.fn() },
    booking: { findFirst: vi.fn() },
    jobRequest: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

import {
  CANCELLABLE_BOOKING_STATUSES,
  CANCELLABLE_JOB_REQUEST_STATUSES,
  resolveCustomerCancelTarget,
} from '@/lib/whatsapp-flows/cancel-routing'
import { phoneLookupVariants } from '@/lib/whatsapp-identity'

const PHONE = '+27820000001'

function activeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking_1',
    status: 'SCHEDULED',
    scheduledDate: new Date('2026-07-08T08:00:00.000Z'),
    job: null,
    match: { jobRequest: { id: 'jr_1', category: 'Plumbing' } },
    ...overrides,
  }
}

describe('resolveCustomerCancelTarget (CJ-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.customer.findFirst.mockResolvedValue({ id: 'cust_1' })
    mockDb.booking.findFirst.mockResolvedValue(null)
    mockDb.jobRequest.findFirst.mockResolvedValue(null)
  })

  it('looks the customer up via phoneLookupVariants, not exact findUnique (CJ-15)', async () => {
    await resolveCustomerCancelTarget(PHONE)

    expect(mockDb.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: { in: phoneLookupVariants(PHONE) } },
    }))
    expect(phoneLookupVariants(PHONE).length).toBeGreaterThan(1)
  })

  it('returns no_customer when the phone matches no customer', async () => {
    mockDb.customer.findFirst.mockResolvedValue(null)

    const target = await resolveCustomerCancelTarget(PHONE)

    expect(target).toEqual({ kind: 'no_customer' })
    expect(mockDb.booking.findFirst).not.toHaveBeenCalled()
  })

  it('routes to the BOOKING when an active booking exists — even if an active job request also exists', async () => {
    mockDb.booking.findFirst.mockResolvedValue(activeBooking())
    mockDb.jobRequest.findFirst.mockResolvedValue({ id: 'jr_other', category: 'Gardening' })

    const target = await resolveCustomerCancelTarget(PHONE)

    expect(target).toMatchObject({ kind: 'booking', bookingId: 'booking_1', category: 'Plumbing', customerId: 'cust_1' })
    // Booking wins: the jobRequest lookup must not decide the target.
    expect(mockDb.jobRequest.findFirst).not.toHaveBeenCalled()
    // Only SCHEDULED/RESCHEDULED bookings are cancellable.
    expect(mockDb.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: CANCELLABLE_BOOKING_STATUSES },
        match: { jobRequest: { customerId: 'cust_1' } },
      }),
    }))
    expect(CANCELLABLE_BOOKING_STATUSES).toEqual(['SCHEDULED', 'RESCHEDULED'])
  })

  it('ignores a booking whose job is already terminal and falls back to the active job request', async () => {
    mockDb.booking.findFirst.mockResolvedValue(activeBooking({ job: { id: 'job_1', status: 'COMPLETED' } }))
    mockDb.jobRequest.findFirst.mockResolvedValue({ id: 'jr_2', category: 'Electrical' })

    const target = await resolveCustomerCancelTarget(PHONE)

    expect(target).toMatchObject({ kind: 'job_request', jobRequestId: 'jr_2', category: 'Electrical' })
  })

  it('routes to the latest active JOB REQUEST when no booking exists (pre-booking states unchanged)', async () => {
    mockDb.jobRequest.findFirst.mockResolvedValue({ id: 'jr_3', category: 'Painting' })

    const target = await resolveCustomerCancelTarget(PHONE)

    expect(target).toMatchObject({ kind: 'job_request', jobRequestId: 'jr_3', customerId: 'cust_1' })
    expect(mockDb.jobRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        customerId: 'cust_1',
        status: { in: [...CANCELLABLE_JOB_REQUEST_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    }))
    expect(CANCELLABLE_JOB_REQUEST_STATUSES).toEqual(['PENDING_VALIDATION', 'OPEN', 'MATCHING', 'MATCHED'])
  })

  it('returns none when the customer has nothing cancellable', async () => {
    const target = await resolveCustomerCancelTarget(PHONE)

    expect(target).toEqual({ kind: 'none', customerId: 'cust_1' })
  })
})
