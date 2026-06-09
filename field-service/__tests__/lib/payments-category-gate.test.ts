import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
  mockCheckPilotGate,
  mockResolveAreaScopeByNodeId,
  mockRecordAuditLog,
} = vi.hoisted(() => ({
  mockDb: {
    booking: { findUnique: vi.fn() },
    payment: { upsert: vi.fn() },
  },
  mockCheckPilotGate: vi.fn(),
  mockResolveAreaScopeByNodeId: vi.fn(),
  mockRecordAuditLog: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/customer-serviceability', () => ({
  checkPilotGate: mockCheckPilotGate,
  resolveAreaScopeByNodeId: mockResolveAreaScopeByNodeId,
}))
vi.mock('@/lib/audit', () => ({
  recordAuditLog: mockRecordAuditLog,
}))

describe('initializeBookingPayment — pilot category gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // getPaymentCollectionMode is env-driven (defaults to 'bypass'); no mock needed.
    mockRecordAuditLog.mockResolvedValue(undefined)
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      match: {
        jobRequest: {
          category: 'electrical',
          address: { locationNodeId: 'node-1' },
        },
      },
    })
    mockResolveAreaScopeByNodeId.mockResolvedValue({
      node: {
        id: 'node-1',
        slug: 'gauteng__johannesburg__jhb_west__honeydew',
        label: 'Honeydew',
        nodeType: 'SUBURB',
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_west',
      },
    })
    mockDb.payment.upsert.mockResolvedValue({})
  })

  it('throws CategoryGatedByPilotError when checkPilotGate rejects', async () => {
    mockCheckPilotGate.mockResolvedValue({
      ok: false,
      code: 'pilot.category_not_supported',
    })

    const { initializeBookingPayment } = await import('@/lib/payments')
    const { CategoryGatedByPilotError } = await import('@/lib/launch/errors')

    await expect(
      initializeBookingPayment({
        bookingId: 'booking-1',
        amountRand: 500,
        description: 'Test',
      }),
    ).rejects.toBeInstanceOf(CategoryGatedByPilotError)

    expect(mockDb.payment.upsert).not.toHaveBeenCalled()
  })

  it('records an audit log row before throwing', async () => {
    mockCheckPilotGate.mockResolvedValue({
      ok: false,
      code: 'pilot.category_not_supported',
    })

    const { initializeBookingPayment } = await import('@/lib/payments')

    await initializeBookingPayment({
      bookingId: 'booking-1',
      amountRand: 500,
      description: 'Test',
    }).catch(() => undefined)

    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRole: 'system',
        action: 'pilot.payment.blocked',
        entityType: 'Booking',
        entityId: 'booking-1',
      }),
    )
  })

  it('passes through when checkPilotGate accepts', async () => {
    mockCheckPilotGate.mockResolvedValue({ ok: true })
    mockDb.booking.findUnique.mockResolvedValue({
      id: 'booking-1',
      match: {
        jobRequest: {
          category: 'plumbing',
          address: { locationNodeId: 'node-1' },
        },
      },
    })

    const { initializeBookingPayment } = await import('@/lib/payments')

    const result = await initializeBookingPayment({
      bookingId: 'booking-1',
      amountRand: 500,
      description: 'Test',
    })

    expect(result.mode).toBe('bypass')
    expect(mockDb.payment.upsert).toHaveBeenCalled()
    expect(mockRecordAuditLog).not.toHaveBeenCalled()
  })
})
