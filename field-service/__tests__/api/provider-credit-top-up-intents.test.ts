import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetSession, mockDb, mockCreateManualEftTopUpIntent } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDb: {
    provider: {
      findUnique: vi.fn(),
    },
  },
  mockCreateManualEftTopUpIntent: vi.fn(),
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
  })

  it('creates a top-up intent with server-derived provider identity and amountCents', async () => {
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
    expect(mockCreateManualEftTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
      metadata: undefined,
    })
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
    expect(mockCreateManualEftTopUpIntent).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-1',
      amountCents: 10_000,
    }))
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
  })
})
