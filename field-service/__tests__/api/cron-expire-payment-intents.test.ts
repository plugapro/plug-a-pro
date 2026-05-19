import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
const mockCreditProviderWalletFromPayatWebhook = vi.fn()
vi.mock('@/lib/provider-credit-gateway-itn', () => ({
  creditProviderWalletFromPayatWebhook: mockCreditProviderWalletFromPayatWebhook,
}))

function cronRequest(authHeader?: string) {
  return new Request('http://localhost/api/cron/expire-payment-intents', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('GET /api/cron/expire-payment-intents', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 3 })
    mockDb.paymentIntent.findMany.mockResolvedValue([])
    mockCreditProviderWalletFromPayatWebhook.mockResolvedValue({
      credited: true,
      ledgerEntryId: 'ledger-1',
    })
  })

  it('rejects requests without an authorization header', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest())

    expect(res.status).toBe(401)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalled()
  })

  it('rejects requests with a wrong bearer token', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer wrong-secret'))

    expect(res.status).toBe(401)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalled()
  })

  it('returns the count of expired intents on success', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      expired: 3,
      payatItnRecovered: 0,
      payatItnSkipped: 0,
      payatItnFailed: 0,
    })
  })

  it('queries with the correct updateMany predicate targeting only lapsed PENDING_PAYMENT intents', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    await GET(cronRequest('Bearer cron-secret'))

    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING_PAYMENT',
        expiresAt: { lt: expect.any(Date), not: null },
      },
      data: { status: 'EXPIRED' },
    })
  })

  it('returns zero expired when nothing has lapsed', async () => {
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 0 })
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ expired: 0 })
  })

  it('retries eligible PAYAT ITN_RECEIVED intents and counts recovery outcomes', async () => {
    mockDb.paymentIntent.findMany.mockResolvedValue([
      { id: 'payat-intent-1' },
      { id: 'payat-intent-2' },
    ])
    mockCreditProviderWalletFromPayatWebhook
      .mockResolvedValueOnce({ credited: true, ledgerEntryId: 'ledger-1' })
      .mockResolvedValueOnce({ credited: false, reason: 'already credited (concurrent call)' })

    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      expired: 3,
      payatItnRecovered: 1,
      payatItnSkipped: 1,
      payatItnFailed: 0,
    })
    expect(mockDb.paymentIntent.findMany).toHaveBeenCalledWith({
      where: {
        paymentMethod: 'PAYAT',
        status: 'ITN_RECEIVED',
        creditedAt: null,
        itnPaymentStatus: { in: ['PAID', 'COMPLETED'] },
        itnReceivedAt: { not: null },
      },
      select: { id: true },
      orderBy: { itnReceivedAt: 'asc' },
      take: 25,
    })
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledTimes(2)
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('payat-intent-1')
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('payat-intent-2')
  })

  it('counts recovery failures when PAYAT ITN recovery throws', async () => {
    mockDb.paymentIntent.findMany.mockResolvedValue([{ id: 'payat-intent-1' }])
    mockCreditProviderWalletFromPayatWebhook.mockRejectedValue(new Error('temporary outage'))

    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      expired: 3,
      payatItnRecovered: 0,
      payatItnSkipped: 0,
      payatItnFailed: 1,
    })
  })
})
