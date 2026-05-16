import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockDb, mockCreditProviderWalletFromPayatWebhook } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockCreditProviderWalletFromPayatWebhook: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/provider-credit-gateway-itn', () => ({
  creditProviderWalletFromPayatWebhook: mockCreditProviderWalletFromPayatWebhook,
}))

function sign(body: string) {
  return createHmac('sha256', 'webhook-secret').update(body).digest('hex')
}

function request(payload: Record<string, unknown>, signature = sign(JSON.stringify(payload))) {
  const body = JSON.stringify(payload)
  return new NextRequest('http://localhost/api/payat/webhook', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'x-payat-signature': signature,
    },
  })
}

describe('POST /api/payat/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_WEBHOOK_SECRET', 'webhook-secret')
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
    })
    mockDb.paymentIntent.update.mockResolvedValue({})
    mockCreditProviderWalletFromPayatWebhook.mockResolvedValue({
      credited: true,
      ledgerEntryId: 'ledger-1',
    })
  })

  it('rejects invalid signatures without touching the wallet', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }, 'bad'))

    expect(res.status).toBe(401)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('marks a matching paid Pay@ intent and credits the wallet exactly once', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-payat-1' },
      data: expect.objectContaining({
        status: 'ITN_RECEIVED',
        itnPaymentStatus: 'PAID',
        itnAmountCents: 10_000,
        gatewayReference: null,
        paidAt: expect.any(Date),
      }),
    })
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('ignores duplicate already credited webhooks without double-crediting', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'CREDITED',
      creditedAt: new Date('2026-05-12T10:00:00.000Z'),
      paymentMethod: 'PAYAT',
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'COMPLETED', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('acknowledges unknown references so Pay@ does not retry forever', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'missing-intent', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('credits wallet when Pay@ sends clientReferenceNumber instead of reference', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(
      request({ clientReferenceNumber: 'intent-payat-1', status: 'PAID', amount: 10_000 }),
    )

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'intent-payat-1' } }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })
})
