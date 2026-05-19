import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetPaymentIntentStatus } = vi.hoisted(() => ({
  mockGetPaymentIntentStatus: vi.fn(),
}))

vi.mock('../../app/(provider)/provider/credits/actions', () => ({
  getPaymentIntentStatus: mockGetPaymentIntentStatus,
}))

describe('GET /api/provider/payment-intent/[intentId]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the polling status payload without exposing internal fields', async () => {
    mockGetPaymentIntentStatus.mockResolvedValue({
      ok: true,
      status: 'CREDITED',
      creditsIssued: 5,
      paidAt: '2026-05-19T08:00:00.000Z',
      creditedAt: '2026-05-19T08:00:30.000Z',
      reference: 'PAT-A3F7BC2D',
      paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
      amountCents: 10_000,
    })

    const { GET } = await import('../../app/api/provider/payment-intent/[intentId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/provider/payment-intent/intent-1/status'),
      { params: Promise.resolve({ intentId: 'intent-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'CREDITED',
      creditsIssued: 5,
    })
  })

  it('fails closed when the provider cannot access the intent', async () => {
    mockGetPaymentIntentStatus.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Payment intent was not found.',
    })

    const { GET } = await import('../../app/api/provider/payment-intent/[intentId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/provider/payment-intent/other-provider-intent/status'),
      { params: Promise.resolve({ intentId: 'other-provider-intent' }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Payment intent was not found.',
      },
    })
  })

  it('rejects malformed intent identifiers at the route boundary', async () => {
    const { GET } = await import('../../app/api/provider/payment-intent/[intentId]/status/route')
    const response = await GET(
      new NextRequest('http://localhost/api/provider/payment-intent/%20/status'),
      { params: Promise.resolve({ intentId: ' ' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INVALID_INTENT_ID',
        message: 'Payment intent id is invalid.',
      },
    })
    expect(mockGetPaymentIntentStatus).not.toHaveBeenCalled()
  })
})
