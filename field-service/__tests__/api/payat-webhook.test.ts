import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockDb, mockCreditProviderWalletFromPayatWebhook } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

function signBase64(body: string) {
  return createHmac('sha256', 'webhook-secret').update(body).digest('base64')
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
      providerId: 'provider-1',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: null,
    })
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)
    mockDb.paymentIntent.update.mockResolvedValue({})
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 1 })
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

  it('accepts base64 signatures and sha256-prefixed signatures', async () => {
    const payload = { reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }
    const body = JSON.stringify(payload)
    const signature = `sha256=${signBase64(body)}`
    const req = new NextRequest('http://localhost/api/payat/webhook', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'x-payat-signature': signature,
      },
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('marks a matching paid Pay@ intent and credits the wallet exactly once', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
      where: { id: 'intent-payat-1', status: 'PENDING_PAYMENT' },
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

  it('normalises amount sent in rands (100) to cents (10000) before comparing', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ gateway variants may send amount as rands e.g. 100 instead of 10000 cents
    const res = await POST(
      request({ clientReferenceNumber: 'intent-payat-1', status: 'PAID', amount: 100 }),
    )

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
      where: { id: 'intent-payat-1', status: 'PENDING_PAYMENT' },
      data: expect.objectContaining({
        status: 'ITN_RECEIVED',
        itnAmountCents: 10_000,
      }),
    })
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('falls back to paymentReference lookup when clientReferenceNumber is absent', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)
    mockDb.paymentIntent.findFirst.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ sends reference = paymentReference (e.g. PAT-ABCDEF) without clientReferenceNumber
    const res = await POST(
      request({ reference: 'PAT-ABCDEF', status: 'PAID', amount: 10_000 }),
    )

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentReference: 'PAT-ABCDEF', paymentMethod: 'PAYAT' }),
      }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('C-1: ignores a PAID webhook for an intent already marked FAILED', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'FAILED',
      creditedAt: null,
      paymentMethod: 'PAYAT',
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ITN_RECEIVED' }) }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('C-1: ignores a COMPLETED webhook for an intent already marked FAILED', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'FAILED',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: null,
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'COMPLETED', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ITN_RECEIVED' }) }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('T-4: CANCELLED webhook marks intent FAILED; subsequent PAID does not credit wallet', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')

    // First: CANCELLED arrives and marks the intent FAILED via updateMany
    const cancelRes = await POST(request({ reference: 'intent-payat-1', status: 'CANCELLED', amount: 10_000 }))
    expect(cancelRes.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )

    // Simulate DB now returning the intent as FAILED
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'FAILED',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: null,
    })

    // Delayed PAID arrives - must be ignored
    const paidRes = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))
    expect(paidRes.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('T-5: rejects base64 signature that decodes to wrong byte length', async () => {
    // "not-32-bytes" base64-encodes to a 9-byte buffer - not a valid SHA-256 HMAC
    const shortBase64 = Buffer.from('not-32-bytes').toString('base64')
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }, shortBase64))
    expect(res.status).toBe(401)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('T-6: skips secondary paymentReference lookup when clientReferenceNumber is present (even non-UUID)', async () => {
    // clientReferenceNumber is present so usedClientRef=true - secondary findFirst must not fire
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ clientReferenceNumber: 'PAT-NOT-A-UUID', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.findFirst).not.toHaveBeenCalled()
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('C-2: uses payAtAmountCents from metadata for amount comparison when fee is present', async () => {
    // Intent was created with a R7 counter fee: amountCents=10000, payAtAmountCents=10700
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: { payAtAmountCents: 10_700 },
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ reports the fee-inclusive amount - should match
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_700 }))
    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('C-2: rejects payment when amount matches credit value but not the fee-inclusive payAtAmountCents', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: { payAtAmountCents: 10_700 },
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ reports 10000 but we expected 10700 - amount mismatch, mark FAILED
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))
    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })
})
