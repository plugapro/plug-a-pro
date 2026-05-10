// Tests for GET /api/customer/messages
// Covers: flag gate, ownership gate, booking-status gate, happy path.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockResolveCustomerForSession,
  mockIsEnabled,
  mockBookingFindUnique,
  mockMessageEventFindMany,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockResolveCustomerForSession: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockBookingFindUnique: vi.fn(),
  mockMessageEventFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/db', () => ({
  db: {
    booking: { findUnique: mockBookingFindUnique },
    messageEvent: { findMany: mockMessageEventFindMany },
  },
}))

const VALID_SESSION = { id: 'user-123', role: 'customer', phone: '+27821234567' }
const CUSTOMER = { id: 'cust-001', userId: 'user-123', phone: '+27821234567', name: 'Alice', email: null }
const BOOKING_ID = 'booking-abc'

function makeRequest(bookingId?: string) {
  const url = bookingId
    ? `http://localhost/api/customer/messages?bookingId=${bookingId}`
    : `http://localhost/api/customer/messages`
  return new NextRequest(url)
}

describe('GET /api/customer/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(VALID_SESSION)
    mockResolveCustomerForSession.mockResolvedValue(CUSTOMER)
    mockIsEnabled.mockResolvedValue(true)
    mockBookingFindUnique.mockResolvedValue({
      status: 'SCHEDULED',
      match: { jobRequest: { customerId: 'cust-001' } },
    })
    mockMessageEventFindMany.mockResolvedValue([
      { id: 'msg-1', direction: 'OUTBOUND', body: 'Hello', status: 'DELIVERED', createdAt: new Date(), templateName: null },
    ])
  })

  it('returns 400 when bookingId query param is missing', async () => {
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('bookingId required')
  })

  it('returns 401 when the session is absent', async () => {
    mockGetSession.mockResolvedValue(null)
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest(BOOKING_ID))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the feature flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest(BOOKING_ID))
    expect(res.status).toBe(404)
    // The flag check must come before the DB ownership query
    expect(mockBookingFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the booking belongs to a different customer', async () => {
    mockBookingFindUnique.mockResolvedValue({
      status: 'SCHEDULED',
      match: { jobRequest: { customerId: 'cust-other' } },
    })
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest(BOOKING_ID))
    expect(res.status).toBe(404)
  })

  it('returns 404 when booking is in a terminal status (COMPLETED)', async () => {
    mockBookingFindUnique.mockResolvedValue({
      status: 'COMPLETED',
      match: { jobRequest: { customerId: 'cust-001' } },
    })
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest(BOOKING_ID))
    expect(res.status).toBe(404)
    expect(mockMessageEventFindMany).not.toHaveBeenCalled()
  })

  it('returns 200 with messages array for a SCHEDULED booking owned by the customer', async () => {
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest(BOOKING_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('messages')
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].id).toBe('msg-1')
  })

  it('returns 200 with messages array for a RESCHEDULED booking', async () => {
    mockBookingFindUnique.mockResolvedValue({
      status: 'RESCHEDULED',
      match: { jobRequest: { customerId: 'cust-001' } },
    })
    const { GET } = await import('../../../../app/api/customer/messages/route')
    const res = await GET(makeRequest(BOOKING_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.messages)).toBe(true)
  })
})
