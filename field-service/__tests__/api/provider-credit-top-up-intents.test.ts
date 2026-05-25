import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetSession,
  mockDb,
  mockCreateManualEftTopUpIntent,
  mockCreatePayatTopUpIntent,
  mockCreatePayfastTopUpIntent,
  mockIssueVerificationLink,
  ProviderCreditPaymentIntentErrorMock,
  PayatConfigErrorMock,
  PayatTokenErrorMock,
  PayatApiErrorMock,
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
  mockIssueVerificationLink: vi.fn(),
  ProviderCreditPaymentIntentErrorMock: class ProviderCreditPaymentIntentError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'ProviderCreditPaymentIntentError'
      this.code = code
    }
  },
  PayatConfigErrorMock: class PayatConfigError extends Error {
    constructor(envVarName: string) {
      super(`${envVarName} must be set`)
      this.name = 'PayatConfigError'
    }
  },
  PayatTokenErrorMock: class PayatTokenError extends Error {
    stage: 'fetch_failed' | 'invalid_response'
    status?: number
    constructor(stage: 'fetch_failed' | 'invalid_response', status?: number) {
      super('token failed')
      this.name = 'PayatTokenError'
      this.stage = stage
      this.status = status
    }
  },
  PayatApiErrorMock: class PayatApiError extends Error {
    stage: 'rtp_create_failed' | 'rtp_response_invalid'
    status?: number
    constructor(stage: 'rtp_create_failed' | 'rtp_response_invalid', status?: number) {
      super('api failed')
      this.name = 'PayatApiError'
      this.stage = stage
      this.status = status
    }
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/csrf', () => ({ verifyRequestOrigin: vi.fn().mockReturnValue(true) }))
vi.mock('@/lib/provider-credit-payment-intents', () => ({
  ProviderCreditPaymentIntentError: ProviderCreditPaymentIntentErrorMock,
  createManualEftTopUpIntent: mockCreateManualEftTopUpIntent,
  createPayatTopUpIntent: mockCreatePayatTopUpIntent,
  createPayfastTopUpIntent: mockCreatePayfastTopUpIntent,
}))
vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: mockIssueVerificationLink,
}))
vi.mock('@/lib/payat', () => ({
  PayatConfigError: PayatConfigErrorMock,
  PayatTokenError: PayatTokenErrorMock,
  PayatApiError: PayatApiErrorMock,
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
    mockIssueVerificationLink.mockResolvedValue({
      verificationId: 'ver-1',
      verificationUrl: 'https://app.plugapro.co.za/provider/verify/secure-token',
      expiresAt: new Date('2026-05-28T10:00:00.000Z'),
      reused: false,
      status: 'NOT_STARTED',
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

  it('maps Pay@ config failures to a deterministic 503 response', async () => {
    mockCreatePayatTopUpIntent.mockRejectedValue(new PayatConfigErrorMock('PAYAT_MERCHANT_ID'))

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYAT_CONFIG_MISSING',
    })
  })

  it('maps Pay@ token failures to 502 with a stable error code', async () => {
    mockCreatePayatTopUpIntent.mockRejectedValue(new PayatTokenErrorMock('fetch_failed', 401))

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYAT_TOKEN_FAILED',
    })
  })

  it('maps Pay@ RTP API failures to 502 with a stable error code', async () => {
    mockCreatePayatTopUpIntent.mockRejectedValue(new PayatApiErrorMock('rtp_create_failed', 422))

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYAT_API_FAILED',
    })
  })

  it('maps provider phone missing to a safe, actionable 400 response', async () => {
    mockCreatePayatTopUpIntent.mockRejectedValue(
      new ProviderCreditPaymentIntentErrorMock(
        'PROVIDER_PHONE_MISSING',
        'internal detail should not leak',
      ),
    )

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'PROVIDER_PHONE_MISSING',
      error: expect.stringContaining('mobile number'),
    })
  })

  it('maps identity-not-verified to 403 for top-up gating', async () => {
    mockCreatePayatTopUpIntent.mockRejectedValue(
      new ProviderCreditPaymentIntentErrorMock(
        'IDENTITY_NOT_VERIFIED',
        'provider identity not verified',
      ),
    )

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: 'IDENTITY_NOT_VERIFIED',
      error: expect.stringContaining('Identity verification is required before buying credits'),
      verificationUrl: 'https://app.plugapro.co.za/provider/verify/secure-token',
    })
    expect(mockIssueVerificationLink).toHaveBeenCalledWith({
      providerId: 'provider-1',
      channel: 'PWA',
    })
  })

  it('maps unknown provider intent failures to a generic safe 400 response', async () => {
    mockCreatePayatTopUpIntent.mockRejectedValue(
      new ProviderCreditPaymentIntentErrorMock(
        'SOME_NEW_CODE',
        'raw internal error',
      ),
    )

    const { POST } = await import('@/app/api/provider/wallet/top-up-intents/route')
    const response = await POST(
      new NextRequest('http://localhost/api/provider/wallet/top-up-intents', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 10_000 }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 'SOME_NEW_CODE',
      error: 'Could not create top-up payment intent.',
    })
  })
})
