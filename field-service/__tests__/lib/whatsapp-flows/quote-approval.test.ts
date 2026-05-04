// ─── Vitest: WhatsApp quote accept / decline reply handlers ──────────────────
// These tests verify processQuoteDecision (called by handleCustomerQuoteResponse
// in whatsapp-bot.ts when the customer taps the Accept or Decline button).
//
// Four required cases:
//   1. accept  → Quote APPROVED, Booking created, AuditLog written
//   2. accept on already-approved → ALREADY_ACTIONED error (idempotent)
//   3. decline → Quote DECLINED, AuditLog written
//   4. wrong customer phone → FORBIDDEN error (silent rejection)

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── DB mock (hoisted so vi.mock factory can reference these) ─────────────────

const { mockDb } = vi.hoisted(() => {
  const mockTx = {
    quote: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    match: { update: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn() },
    technicianScheduleItem: {
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  }

  return {
    mockDb: {
      $transaction: vi.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
      ...mockTx,
    },
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))

import { processQuoteDecision } from '@/lib/quotes'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CUSTOMER_PHONE = '+27610000001'
const PROVIDER_PHONE = '+27620000002'
const QUOTE_ID = 'quote_test_001'
const MATCH_ID = 'match_test_001'

function makeQuoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: QUOTE_ID,
    matchId: MATCH_ID,
    status: 'PENDING',
    preferredDate: new Date('2026-06-15T09:00:00Z'),
    validUntil: new Date('2099-12-31T00:00:00Z'),
    estimatedHours: 2,
    notes: null,
    match: {
      id: MATCH_ID,
      provider: { id: 'prov_001', phone: PROVIDER_PHONE, name: 'Sipho Dlamini' },
      jobRequest: {
        id: 'jr_test_001',
        category: 'Plumbing',
        isTestRequest: false,
        cohortName: null,
        customer: { id: 'cust_001', phone: CUSTOMER_PHONE, name: 'Thabo Nkosi' },
        address: { suburb: 'Sandton', city: 'Johannesburg', lat: -26.1, lng: 28.05 },
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.$transaction.mockImplementation(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  )
  mockDb.quote.findUnique.mockResolvedValue(makeQuoteRow())
  mockDb.quote.updateMany.mockResolvedValue({ count: 1 })
  mockDb.match.update.mockResolvedValue({})
  mockDb.booking.create.mockResolvedValue({ id: 'booking_test_001' })
  mockDb.job.create.mockResolvedValue({ id: 'job_test_001' })
  mockDb.technicianScheduleItem.updateMany.mockResolvedValue({ count: 0 })
  mockDb.technicianScheduleItem.create.mockResolvedValue({ id: 'sched_test_001' })
  mockDb.auditLog.create.mockResolvedValue({ id: 'audit_test_001' })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('processQuoteDecision — accept', () => {
  it('updates quote to APPROVED and creates a booking', async () => {
    const result = await processQuoteDecision(QUOTE_ID, 'approve', {
      verifyCustomerPhone: CUSTOMER_PHONE,
    })

    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.action).toBe('approved')

    const approved = result as Extract<typeof result, { action: 'approved' }>
    expect(approved.bookingId).toBe('booking_test_001')

    // Quote claimed as APPROVED
    expect(mockDb.quote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: QUOTE_ID, status: 'PENDING' }),
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    )

    // Booking created
    expect(mockDb.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchId: MATCH_ID,
          quoteId: QUOTE_ID,
          status: 'SCHEDULED',
        }),
      }),
    )

    // AuditLog written
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'quote.approved',
          entityType: 'Quote',
          entityId: QUOTE_ID,
        }),
      }),
    )
  })

  it('returns ALREADY_ACTIONED when quote is no longer PENDING (idempotent)', async () => {
    mockDb.quote.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await processQuoteDecision(QUOTE_ID, 'approve', {
      verifyCustomerPhone: CUSTOMER_PHONE,
    })

    expect(result).toEqual({ error: 'ALREADY_ACTIONED' })
    expect(mockDb.booking.create).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
  })
})

describe('processQuoteDecision — decline', () => {
  it('updates quote to DECLINED and writes AuditLog', async () => {
    const result = await processQuoteDecision(QUOTE_ID, 'decline', {
      verifyCustomerPhone: CUSTOMER_PHONE,
    })

    expect(result).not.toHaveProperty('error')
    if ('error' in result) return
    expect(result.action).toBe('declined')

    // Quote claimed as DECLINED
    expect(mockDb.quote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: QUOTE_ID, status: 'PENDING' }),
        data: expect.objectContaining({ status: 'DECLINED' }),
      }),
    )

    // No booking created on decline
    expect(mockDb.booking.create).not.toHaveBeenCalled()

    // AuditLog written
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'quote.declined',
          entityType: 'Quote',
          entityId: QUOTE_ID,
        }),
      }),
    )
  })
})

describe('processQuoteDecision — wrong phone (security)', () => {
  it('returns FORBIDDEN when the phone does not match the customer', async () => {
    const result = await processQuoteDecision(QUOTE_ID, 'approve', {
      verifyCustomerPhone: '+27699999999', // wrong phone
    })

    expect(result).toEqual({ error: 'FORBIDDEN' })
    expect(mockDb.quote.updateMany).not.toHaveBeenCalled()
    expect(mockDb.booking.create).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
  })
})
