import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processQuoteDecision } from '../../lib/quotes'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    quote: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    match: { update: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn() },
    technicianScheduleItem: { create: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

describe('processQuoteDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )
    mockDb.technicianScheduleItem.updateMany.mockResolvedValue({})
    mockDb.quote.updateMany.mockResolvedValue({ count: 1 })
  })

  it('stores customer feedback when a quote is declined for revision', async () => {
    mockDb.quote.findUnique.mockResolvedValue({
      id: 'quote-1',
      status: 'PENDING',
      validUntil: new Date(Date.now() + 60_000),
      matchId: 'match-1',
      match: {
        matchId: 'match-1',
        provider: { id: 'provider-1', phone: '+27123456789', name: 'Provider Pro' },
        jobRequest: {
          category: 'plumbing',
          customer: { id: 'customer-1', phone: '+27999999999', name: 'Customer' },
          address: { suburb: 'Sandton', city: 'Johannesburg', lat: null, lng: null },
        },
      },
    })
    mockDb.match.update.mockResolvedValue({})

    const result = await processQuoteDecision('quote-1', 'decline', {
      customerFeedback: 'Need the quote broken down more clearly: split labour and materials by item',
    })

    expect(result).toEqual({
      action: 'declined',
      quoteId: 'quote-1',
      matchId: 'match-1',
      canRevise: true,
      feedback: 'Need the quote broken down more clearly: split labour and materials by item',
      provider: { id: 'provider-1', phone: '+27123456789', name: 'Provider Pro' },
      customer: { id: 'customer-1', phone: '+27999999999', name: 'Customer' },
      category: 'plumbing',
    })
    expect(mockDb.quote.updateMany).toHaveBeenCalledWith({
      where: { id: 'quote-1', status: 'PENDING' },
      data: {
        status: 'DECLINED',
        declinedAt: expect.any(Date),
        notes: 'Need the quote broken down more clearly: split labour and materials by item',
      },
    })
  })

  it('fails cleanly when approving a legacy quote without a preferred date', async () => {
    mockDb.quote.findUnique.mockResolvedValue({
      id: 'quote-1',
      status: 'PENDING',
      validUntil: new Date(Date.now() + 60_000),
      preferredDate: null,
      amount: 850,
      matchId: 'match-1',
      match: {
        matchId: 'match-1',
        provider: { id: 'provider-1', phone: '+27123456789', name: 'Provider Pro' },
        jobRequest: {
          category: 'plumbing',
          customer: { id: 'customer-1', phone: '+27999999999', name: 'Customer' },
          address: { suburb: 'Sandton', city: 'Johannesburg', lat: null, lng: null },
        },
      },
    })
    mockDb.match.update.mockResolvedValue({})

    const result = await processQuoteDecision('quote-1', 'approve')

    expect(result).toEqual({ error: 'MISSING_PREFERRED_DATE' })
    expect(mockDb.booking.create).not.toHaveBeenCalled()
  })

  it('approves a quote and creates booking artifacts without creating platform payment', async () => {
    const preferredDate = new Date('2030-01-01T08:00:00.000Z')
    mockDb.quote.findUnique.mockResolvedValue({
      id: 'quote-1',
      status: 'PENDING',
      validUntil: new Date(Date.now() + 60_000),
      preferredDate,
      estimatedHours: 2,
      amount: 850,
      matchId: 'match-1',
      match: {
        provider: { id: 'provider-1', phone: '+27123456789', name: 'Provider Pro' },
        jobRequest: {
          id: 'job-request-1',
          category: 'plumbing',
          estimatedDurationMinutes: null,
          customer: { id: 'customer-1', phone: '+27999999999', name: 'Customer' },
          address: { suburb: 'Sandton', city: 'Johannesburg', lat: null, lng: null },
        },
      },
    })
    mockDb.match.update.mockResolvedValue({})
    mockDb.booking.create.mockResolvedValue({ id: 'booking-1' })
    mockDb.job.create.mockResolvedValue({})
    mockDb.technicianScheduleItem.create.mockResolvedValue({})

    const result = await processQuoteDecision('quote-1', 'approve')

    expect(result).toEqual({
      action: 'approved',
      quoteId: 'quote-1',
      matchId: 'match-1',
      jobRequestId: 'job-request-1',
      bookingId: 'booking-1',
      scheduledDate: preferredDate,
      provider: { id: 'provider-1', phone: '+27123456789', name: 'Provider Pro' },
      customer: { id: 'customer-1', phone: '+27999999999', name: 'Customer' },
      category: 'plumbing',
    })
    expect(mockDb.booking.create).toHaveBeenCalledOnce()
    expect(mockDb.job.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-1',
        providerId: 'provider-1',
        status: 'SCHEDULED',
        isTestJob: false,
        cohortName: null,
      },
    })
  })
})
