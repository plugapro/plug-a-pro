import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockDb,
  mockCreateManualEftTopUpIntent,
  mockCreatePayatTopUpIntent,
  mockCreatePayfastTopUpIntent,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    provider: {
      findUnique: vi.fn(),
    },
  },
  mockCreateManualEftTopUpIntent: vi.fn(),
  mockCreatePayatTopUpIntent: vi.fn(),
  mockCreatePayfastTopUpIntent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/provider-credit-payment-intents', () => ({
  ProviderCreditPaymentIntentError: class ProviderCreditPaymentIntentError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'ProviderCreditPaymentIntentError'
    }
  },
  createManualEftTopUpIntent: mockCreateManualEftTopUpIntent,
  createPayatTopUpIntent: mockCreatePayatTopUpIntent,
  createPayfastTopUpIntent: mockCreatePayfastTopUpIntent,
}))

describe('POST /api/provider/wallet/top-up-intents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({
      id: 'user-1',
      role: 'provider',
      phone: '+27821234567',
    })
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-1',
      phone: '+27820000000',
    })
    mockCreateManualEftTopUpIntent.mockResolvedValue({
      intent: { id: 'intent-1', status: 'PENDING_PAYMENT' },
      instructions: { amountCents: 10_000 },
    })
    mockCreatePayatTopUpIntent.mockResolvedValue({
      intent: { id: 'intent-payat-1', status: 'PENDING_PAYMENT' },
      payment: {
        reference: 'intent-payat-1',
        qrCodeUrl: 'https://go.payat.co.za/qr/intent-payat-1',
        paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
      },
    })
    mockCreatePayfastTopUpIntent.mockResolvedValue({
      intent: { id: 'intent-payfast-1', status: 'PENDING_PAYMENT' },
      checkout: { action: 'https://sandbox.payfast.co.za/eng/process', fields: {} },
    })
  })

  it('defaults to Pay@ and creates a top-up intent with server-derived provider identity', async () => {
    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockDb.provider.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { id: true, phone: true, name: true, email: true },
    })
    expect(mockCreatePayatTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
      metadata: undefined,
    })
    expect(mockCreateManualEftTopUpIntent).not.toHaveBeenCalled()
  })

  it('keeps the documented amountRand compatibility path behind the same validation seam', async () => {
    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountRand: 100 }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockCreatePayatTopUpIntent).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-1',
      amountCents: 10_000,
    }))
  })

  it('accepts string amounts from non-browser clients', async () => {
    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: '10000' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockCreatePayatTopUpIntent).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-1',
      amountCents: 10_000,
    }))
  })

  it('keeps manual EFT available as an explicit secondary provider path', async () => {
    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000, paymentMethod: 'MANUAL_EFT' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockCreateManualEftTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
      metadata: undefined,
    })
  })

  it('keeps Payfast available as an explicit secondary provider path', async () => {
    mockDb.provider.findUnique.mockResolvedValue({
      id: 'provider-1',
      phone: '+27820000000',
      name: 'Provider One',
      email: 'provider@example.com',
    })

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000, paymentMethod: 'PAYFAST_CARD' }),
      }),
    )

    expect(response.status).toBe(201)
    expect(mockCreatePayfastTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      paymentMethod: 'PAYFAST_CARD',
      providerName: 'Provider One',
      providerEmail: 'provider@example.com',
      providerCellphone: '+27821234567',
      metadata: undefined,
    })
  })

  it('rejects non-provider sessions before provider lookup', async () => {
    mockGetSession.mockResolvedValue({ id: 'admin-1', role: 'admin' })

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(401)
    expect(mockDb.provider.findUnique).not.toHaveBeenCalled()
    expect(mockCreateManualEftTopUpIntent).not.toHaveBeenCalled()
    expect(mockCreatePayatTopUpIntent).not.toHaveBeenCalled()
  })
})
