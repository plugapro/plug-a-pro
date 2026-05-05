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
    },
  },
}))

vi.mock('../../lib/provider-wallet', () => ({
  getProviderWalletBalance: vi.fn(),
  getProviderWalletLedgerEntries: vi.fn(),
}))

vi.mock('../../lib/provider-credit-payment-intents', () => ({
  createManualEftTopUpIntent: vi.fn(),
}))

describe('provider credits server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PROVIDER_CREDIT_EFT_ACCOUNT_NAME', 'Plug-A-Pro Holdings')
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
          accountName: 'Plug-A-Pro Holdings',
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
          accountName: 'Plug-A-Pro Holdings',
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
