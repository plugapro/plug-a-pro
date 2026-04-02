import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canSend, applyOptOut, applyOptIn } from '../../lib/whatsapp-policy'

vi.mock('../../lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PHONE = '+27821234567'

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-001',
    phone: PHONE,
    whatsappServiceOptIn: true,
    whatsappMarketingOptIn: true,
    ...overrides,
  }
}

/** Returns a tx stub whose customer.findUnique resolves to `current`. */
function makeTx(current: Record<string, unknown> | null) {
  return {
    customer: {
      findUnique: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsappPreferenceLog: { create: vi.fn().mockResolvedValue({}) },
  }
}

// ─── canSend ──────────────────────────────────────────────────────────────────

describe('canSend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1. UTILITY template allowed when whatsappServiceOptIn = true', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(makeCustomer())

    const result = await canSend(PHONE, 'booking_confirmation')

    expect(result).toEqual({ allowed: true })
  })

  it('2. UTILITY template blocked (service_opted_out) when whatsappServiceOptIn = false', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(
      makeCustomer({ whatsappServiceOptIn: false }),
    )

    const result = await canSend(PHONE, 'booking_confirmation')

    expect(result).toEqual({ allowed: false, reason: 'service_opted_out' })
  })

  it('3. MARKETING template blocked (marketing_opted_out) when whatsappMarketingOptIn = false', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(
      makeCustomer({ whatsappMarketingOptIn: false }),
    )

    const result = await canSend(PHONE, 'booking_cancelled')

    expect(result).toEqual({ allowed: false, reason: 'marketing_opted_out' })
  })

  it('4. MARKETING template allowed when whatsappMarketingOptIn = true', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(makeCustomer())

    const result = await canSend(PHONE, 'booking_cancelled')

    expect(result).toEqual({ allowed: true })
  })

  it('5. returns unknown_template for an unrecognised template name', async () => {
    const result = await canSend(PHONE, 'does_not_exist' as any)

    expect(result).toEqual({ allowed: false, reason: 'unknown_template' })
  })

  it('6. returns customer_not_found when db returns null for a UTILITY template', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(null)

    const result = await canSend(PHONE, 'booking_confirmation')

    expect(result).toEqual({ allowed: false, reason: 'customer_not_found' })
  })

  it('7. returns customer_not_found when db returns null for a MARKETING template', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(null)

    const result = await canSend(PHONE, 'booking_cancelled')

    expect(result).toEqual({ allowed: false, reason: 'customer_not_found' })
  })

  it('8. returns db_error when db.customer.findUnique throws', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockRejectedValue(new Error('connection refused'))

    const result = await canSend(PHONE, 'booking_confirmation')

    expect(result).toEqual({ allowed: false, reason: 'db_error' })
  })
})

// ─── applyOptOut ──────────────────────────────────────────────────────────────

describe('applyOptOut', () => {
  beforeEach(() => vi.clearAllMocks())

  it('9. no-op (no $transaction call) when customer not found', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(null)

    await applyOptOut(PHONE, 'bot')

    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('10. calls $transaction when customer exists (marketing opt-out)', async () => {
    const { db } = await import('../../lib/db')
    const customer = makeCustomer()
    ;(db.customer.findUnique as any).mockResolvedValue(customer)

    const tx = makeTx({ whatsappMarketingOptIn: true, whatsappServiceOptIn: true })
    ;(db.$transaction as any).mockImplementation((fn: any) => fn(tx))

    await applyOptOut(PHONE, 'bot')

    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: customer.id },
        data: expect.objectContaining({ whatsappMarketingOptIn: false }),
      }),
    )
    expect(tx.whatsappPreferenceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          field: 'whatsappMarketingOptIn',
          newValue: false,
          source: 'bot',
        }),
      }),
    )
  })

  it('11. passes correct oldValue = false when customer was already opted out', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(makeCustomer())

    const tx = makeTx({ whatsappMarketingOptIn: false, whatsappServiceOptIn: true })
    ;(db.$transaction as any).mockImplementation((fn: any) => fn(tx))

    await applyOptOut(PHONE, 'pwa')

    expect(tx.whatsappPreferenceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldValue: false, newValue: false }),
      }),
    )
  })

  it('12. passes correct oldValue = true when customer was currently opted in', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(makeCustomer())

    const tx = makeTx({ whatsappMarketingOptIn: true, whatsappServiceOptIn: true })
    ;(db.$transaction as any).mockImplementation((fn: any) => fn(tx))

    await applyOptOut(PHONE, 'admin')

    expect(tx.whatsappPreferenceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldValue: true, newValue: false }),
      }),
    )
  })

  it('13. serviceOptOut=true updates whatsappServiceOptIn field', async () => {
    const { db } = await import('../../lib/db')
    const customer = makeCustomer()
    ;(db.customer.findUnique as any).mockResolvedValue(customer)

    const tx = makeTx({ whatsappMarketingOptIn: true, whatsappServiceOptIn: true })
    ;(db.$transaction as any).mockImplementation((fn: any) => fn(tx))

    await applyOptOut(PHONE, 'bot', { serviceOptOut: true })

    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: customer.id },
        data: expect.objectContaining({ whatsappServiceOptIn: false }),
      }),
    )
    expect(tx.whatsappPreferenceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          field: 'whatsappServiceOptIn',
          newValue: false,
        }),
      }),
    )
  })
})

// ─── applyOptIn ───────────────────────────────────────────────────────────────

describe('applyOptIn', () => {
  beforeEach(() => vi.clearAllMocks())

  it('14. no-op when customer not found', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(null)

    await applyOptIn(PHONE, 'pwa')

    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('15. calls $transaction when customer exists', async () => {
    const { db } = await import('../../lib/db')
    const customer = makeCustomer()
    ;(db.customer.findUnique as any).mockResolvedValue(customer)

    const tx = makeTx({ whatsappMarketingOptIn: false, whatsappServiceOptIn: true })
    ;(db.$transaction as any).mockImplementation((fn: any) => fn(tx))

    await applyOptIn(PHONE, 'pwa')

    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: customer.id },
        data: expect.objectContaining({ whatsappMarketingOptIn: true }),
      }),
    )
    expect(tx.whatsappPreferenceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          field: 'whatsappMarketingOptIn',
          newValue: true,
          source: 'pwa',
        }),
      }),
    )
  })

  it('16. passes correct oldValue from inside transaction', async () => {
    const { db } = await import('../../lib/db')
    ;(db.customer.findUnique as any).mockResolvedValue(makeCustomer())

    // Simulate customer who was previously opted out
    const tx = makeTx({ whatsappMarketingOptIn: false, whatsappServiceOptIn: true })
    ;(db.$transaction as any).mockImplementation((fn: any) => fn(tx))

    await applyOptIn(PHONE, 'admin')

    expect(tx.whatsappPreferenceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ oldValue: false, newValue: true }),
      }),
    )
  })
})
