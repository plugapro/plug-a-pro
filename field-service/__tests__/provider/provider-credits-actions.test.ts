import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`)
  }),
}))

vi.mock('../../lib/auth', () => ({
  requireProvider: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    provider: {
      findUnique: vi.fn(),
    },
    walletLedgerEntry: {
      findMany: vi.fn(),
    },
    paymentIntent: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('../../lib/provider-wallet', () => ({
  getProviderWalletBalance: vi.fn(),
  getProviderWalletLedgerEntries: vi.fn(),
}))

vi.mock('../../lib/provider-credit-payment-intents', () => ({
  createPayatTopUpIntent: vi.fn(),
  createManualEftTopUpIntent: vi.fn(),
  createPayfastTopUpIntent: vi.fn(),
  ProviderCreditPaymentIntentError: class ProviderCreditPaymentIntentError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'ProviderCreditPaymentIntentError'
    }
  },
}))

vi.mock('../../lib/payat', () => ({
  PayatConfigError: class PayatConfigError extends Error {
    constructor(envVarName: string) {
      super(`${envVarName} must be set`)
      this.name = 'PayatConfigError'
    }
  },
}))

describe('provider credits server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME', 'Plug A Pro Holdings')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BANK_NAME', 'Pilot Bank')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NUMBER', '123456789')
    vi.stubEnv('PROVIDER_CREDIT_EFT_BRANCH_CODE', '250655')
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_TYPE', 'Business current account')
  })

  async function arrangeProvider() {
    const { requireProvider } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(requireProvider as any).mockResolvedValue({
      id: 'user-1',
      role: 'provider',
      phone: '+27821234567',
    })
    ;(db.provider.findUnique as any).mockResolvedValue({
      id: 'provider-1',
      phone: '+27821234567',
    })

    return { db }
  }

  it('returns the authenticated provider wallet summary', async () => {
    await arrangeProvider()
    const { getProviderWalletBalance } = await import('../../lib/provider-wallet')
    ;(getProviderWalletBalance as any).mockResolvedValue({
      providerId: 'provider-1',
      paidCreditBalance: 7,
      promoCreditBalance: 3,
      totalCreditBalance: 10,
      status: 'ACTIVE',
    })

    const { getProviderWalletSummary } = await import('../../app/(provider)/provider/credits/actions')

    await expect(getProviderWalletSummary()).resolves.toEqual({
      totalAvailableCredits: 10,
      paidCredits: 7,
      promoCredits: 3,
      estimatedLeadsUnlockable: 10,
    })
    expect(getProviderWalletBalance).toHaveBeenCalledWith('provider-1')
  })

  it('queries ledger entries only for the authenticated provider and omits internal metadata', async () => {
    await arrangeProvider()
    const { getProviderWalletLedgerEntries } = await import('../../lib/provider-wallet')
    ;(getProviderWalletLedgerEntries as any).mockResolvedValue([
      {
        id: 'entry-1',
        entryType: 'ADMIN_ADJUSTMENT',
        creditType: 'PAID',
        amountCredits: 2,
        balanceAfterPaidCredits: 8,
        balanceAfterPromoCredits: 1,
        referenceType: 'admin_case',
        referenceId: 'case-secret-admin-note',
        createdAt: new Date('2026-04-29T12:00:00.000Z'),
        metadata: { internalNote: 'should not be selected' },
      },
    ])

    const { getProviderWalletLedger } = await import('../../app/(provider)/provider/credits/actions')
    const ledger = await getProviderWalletLedger()

    expect(getProviderWalletLedgerEntries).toHaveBeenCalledWith('provider-1', { limit: 20 })
    expect(ledger[0]).toEqual({
      id: 'entry-1',
      occurredAt: '2026-04-29T12:00:00.000Z',
      label: 'Wallet adjustment',
      detail: 'Ref MIN-NOTE',
      creditType: 'PAID',
      amountCredits: 2,
      signedAmountCredits: 2,
      balanceAfterPaidCredits: 8,
      balanceAfterPromoCredits: 1,
    })
  })

  it('loads manual EFT instructions only when the intent belongs to the authenticated provider', async () => {
    const { db } = await arrangeProvider()
    ;(db.paymentIntent.findFirst as any).mockResolvedValue(null)

    const { getProviderTopUpIntentInstructions } = await import('../../app/(provider)/provider/credits/actions')

    await expect(getProviderTopUpIntentInstructions('intent-other')).resolves.toBeNull()
    expect(db.paymentIntent.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'intent-other',
        providerId: 'provider-1',
        paymentMethod: 'MANUAL_EFT',
      },
    })
  })

  it('creates top-up intents with the authenticated provider id', async () => {
    await arrangeProvider()
    const { createManualEftTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
    ;(createManualEftTopUpIntent as any).mockResolvedValue({
      intent: {
        id: 'intent-1',
        status: 'PENDING_PAYMENT',
      },
      instructions: {
        amountCents: 10_000,
        amountFormatted: 'R 100,00',
        currency: 'ZAR',
        creditsToIssue: 2,
        paymentReference: 'PAP-7842-9F3K',
        expiresAt: new Date('2026-05-06T12:00:00.000Z'),
        bankAccount: {
          accountName: 'Plug A Pro Holdings',
          bankName: 'Pilot Bank',
          accountNumber: '123456789',
          branchCode: '250655',
          accountType: 'Business current account',
        },
      },
    })

    const { createProviderTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
    const result = await createProviderTopUpIntent(10_000)

    expect(createManualEftTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
    })
    expect(result).toMatchObject({
      intentId: 'intent-1',
      creditsToIssue: 2,
      paymentReference: 'PAP-7842-9F3K',
    })
  })

  describe('createProviderPayatTopUpIntent error classification', () => {
    it('returns TOO_MANY_PENDING when provider already has 3 pending intents', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(3)

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'TOO_MANY_PENDING' })
      expect(result.ok === false && result.userMessage).toContain('3 pending')
    })

    it('returns PAYAT_CONFIG_MISSING when PayatConfigError is thrown by payment layer', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      const { PayatConfigError } = await import('../../lib/payat')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new PayatConfigError('PAYAT_MERCHANT_IDENTIFIER'))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'PAYAT_CONFIG_MISSING' })
    })

    it('returns PAYAT_TOKEN_FAILED when token fetch error is thrown', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new Error('Pay@ token fetch failed: 401'))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'PAYAT_TOKEN_FAILED' })
    })

    it('returns PAYAT_API_FAILED when RTP creation error is thrown', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new Error('Pay@ RTP creation failed: HTTP 422'))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'PAYAT_API_FAILED' })
    })

    it('returns UNKNOWN for unrecognised errors', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new Error('network error'))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' })
    })
  })

  describe('createProviderPayfastTopUpIntent', () => {
    it('returns TOO_MANY_PENDING discriminated union (not throw) when count >= 3', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(3)

      const { createProviderPayfastTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayfastTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'TOO_MANY_PENDING' })
    })

    it('returns ok:true with checkout when payment layer succeeds', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayfastTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      ;(createPayfastTopUpIntent as any).mockResolvedValue({
        intent: { id: 'pf-intent-1' },
        checkout: { action: 'https://sandbox.payfast.co.za/eng/process', fields: {} },
      })

      const { createProviderPayfastTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayfastTopUpIntent(10_000)

      expect(result).toMatchObject({
        ok: true,
        intentId: 'pf-intent-1',
        checkout: expect.objectContaining({ action: expect.stringContaining('payfast') }),
      })
    })
  })

  it('redirects form submissions to the newly created top-up instructions', async () => {
    await arrangeProvider()
    const { createManualEftTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
    ;(createManualEftTopUpIntent as any).mockResolvedValue({
      intent: {
        id: 'intent-1',
        status: 'PENDING_PAYMENT',
      },
      instructions: {
        amountCents: 10_000,
        amountFormatted: 'R 100,00',
        currency: 'ZAR',
        creditsToIssue: 2,
        paymentReference: 'PAP-7842-9F3K',
        expiresAt: null,
        bankAccount: {
          accountName: 'Plug A Pro Holdings',
          bankName: 'Pilot Bank',
          accountNumber: '123456789',
          branchCode: '250655',
          accountType: 'Business current account',
        },
      },
    })

    const { createProviderTopUpIntentFormAction } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const formData = new FormData()
    formData.set('amountCents', '10000')

    await expect(createProviderTopUpIntentFormAction(formData)).rejects.toThrow(
      'redirect:/provider/credits?intent=intent-1',
    )
    expect(createManualEftTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
    })
  })
})
