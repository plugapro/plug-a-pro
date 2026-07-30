import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readPayatSingleRtp } from '@/lib/payat/read'
import { invalidatePayatToken } from '@/lib/payat/token'

vi.mock('@/lib/payat/token', () => ({
  getPayatToken: vi.fn().mockResolvedValue('tok'),
  invalidatePayatToken: vi.fn(),
}))

describe('readPayatSingleRtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('rejects a lookup key that is not 1-14 digits before touching the network', async () => {
    // The value is interpolated into the URL path and now comes from the DB,
    // not the generator - same guard the sibling client applies.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(readPayatSingleRtp('123abc')).rejects.toThrow(/1-14 numeric digits/)
    await expect(readPayatSingleRtp('')).rejects.toThrow(/1-14 numeric digits/)
    await expect(readPayatSingleRtp('123456789012345')).rejects.toThrow(/1-14 numeric digits/)
    await expect(readPayatSingleRtp('../../etc/passwd')).rejects.toThrow(/1-14 numeric digits/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops the cached token and retries once on a 401 instead of failing until the cache lapses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          accountState: 'PAYMENT_COMPLETED', amount: 10000, amountPaid: 10000,
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const state = await readPayatSingleRtp('12345678901234')

    expect(invalidatePayatToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(state.internalStatus).toBe('PAID')
    warnSpy.mockRestore()
  })

  it('does not retry a 401 forever - the second 401 throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized',
    })
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(readPayatSingleRtp('12345678901234')).rejects.toThrow(/401/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
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
