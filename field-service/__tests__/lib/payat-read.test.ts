import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readPayatSingleRtp } from '@/lib/payat/read'

vi.mock('@/lib/payat/token', () => ({ getPayatToken: vi.fn().mockResolvedValue('tok') }))

describe('readPayatSingleRtp', () => {
  beforeEach(() => {
    vi.stubEnv('PAYAT_API_BASE', 'https://go.payat.co.za/yapi/v1')
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', 'merchant-abc')
  })

  it('maps a completed payment to PAID with paid amount and timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        accountState: 'PAYMENT_COMPLETED',
        amount: 10000,
        amountPaid: 10000,
        dateTimePaid: '2026-07-17T14:38:00Z',
        dateTimeExpire: '2026-07-18T12:29:00Z',
      }),
    }))

    const state = await readPayatSingleRtp('12345678901234')

    expect(state.internalStatus).toBe('PAID')
    expect(state.amountPaidCents).toBe(10000)
    expect(state.paidAt).toEqual(new Date('2026-07-17T14:38:00Z'))
  })

  it('maps an outstanding payment to SENT and reports no paid amount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accountState: 'PAYMENT_OUTSTANDING', amount: 10000, amountPaid: 0 }),
    }))

    const state = await readPayatSingleRtp('12345678901234')

    expect(state.internalStatus).toBe('SENT')
    expect(state.amountPaidCents).toBe(0)
    expect(state.paidAt).toBeNull()
  })

  it('maps a partial payment to FAILED so it can never satisfy an intent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accountState: 'PARTIAL_PAYMENT_RECEIVED', amount: 10000, amountPaid: 500 }),
    }))

    const state = await readPayatSingleRtp('12345678901234')

    expect(state.internalStatus).toBe('FAILED')
  })

  it('throws PayatApiError on a non-2xx response rather than reporting a false state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'insufficient_scope',
    }))

    await expect(readPayatSingleRtp('12345678901234')).rejects.toThrow(/403/)
  })
})
