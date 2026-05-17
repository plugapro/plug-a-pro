import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

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
    expect(body).toEqual({ expired: 3 })
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
    expect(body).toEqual({ expired: 0 })
  })
})
