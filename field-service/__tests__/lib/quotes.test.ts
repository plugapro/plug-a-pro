import { beforeEach, describe, expect, it, vi } from 'vitest'
import { processQuoteDecision } from '../../lib/quotes'

const { mockDb, mockInitializeBookingPayment } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    quote: { findUnique: vi.fn(), update: vi.fn() },
    match: { update: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn() },
    technicianScheduleItem: { create: vi.fn(), updateMany: vi.fn() },
  },
  mockInitializeBookingPayment: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/payments', () => ({
  initializeBookingPayment: mockInitializeBookingPayment,
}))

describe('processQuoteDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )
    mockDb.technicianScheduleItem.updateMany.mockResolvedValue({})
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
    mockDb.quote.update.mockResolvedValue({})
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
    expect(mockDb.quote.update).toHaveBeenCalledWith({
      where: { id: 'quote-1' },
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
    mockDb.quote.update.mockResolvedValue({})
    mockDb.match.update.mockResolvedValue({})

    const result = await processQuoteDecision('quote-1', 'approve')

    expect(result).toEqual({ error: 'MISSING_PREFERRED_DATE' })
    expect(mockDb.booking.create).not.toHaveBeenCalled()
    expect(mockInitializeBookingPayment).not.toHaveBeenCalled()
  })
})
