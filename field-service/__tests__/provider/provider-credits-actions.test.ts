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
    providerWallet: {
      upsert: vi.fn(),
    },
    walletLedgerEntry: {
      findMany: vi.fn(),
    },
    paymentIntent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
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

vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyProviderPayatTopUpInitiated: vi.fn(),
  notifyProviderPaymentIntentCreated: vi.fn(),
}))

vi.mock('../../lib/payat', () => ({
  PayatConfigError: class PayatConfigError extends Error {
    constructor(envVarName: string) {
      super(`${envVarName} must be set`)
      this.name = 'PayatConfigError'
    }
  },
  PayatTokenError: class PayatTokenError extends Error {
    stage: 'fetch_failed' | 'invalid_response'
    status?: number
    constructor(stage: 'fetch_failed' | 'invalid_response' = 'fetch_failed', status?: number) {
      super('token failure')
      this.name = 'PayatTokenError'
      this.stage = stage
      this.status = status
    }
  },
  PayatApiError: class PayatApiError extends Error {
    stage: 'rtp_create_failed' | 'rtp_response_invalid'
    status?: number
    constructor(stage: 'rtp_create_failed' | 'rtp_response_invalid' = 'rtp_create_failed', status?: number) {
      super('api failure')
      this.name = 'PayatApiError'
      this.stage = stage
      this.status = status
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
    ;(db.providerWallet.upsert as any).mockResolvedValue({ id: 'wallet-1' })

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
      label: 'Credit adjustment',
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

  it('falls back to session phone when provider profile phone is null for Pay@ top-ups', async () => {
    const { db } = await arrangeProvider()
    ;(db.provider.findUnique as any).mockResolvedValue({
      id: 'provider-1',
      phone: null,
    })
    ;(db.paymentIntent.count as any).mockResolvedValue(0)
    const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
    ;(createPayatTopUpIntent as any).mockResolvedValue({
      intent: {
        id: 'intent-payat-1',
        amountCents: 10_000,
        creditsToIssue: 2,
        paymentReference: 'PAT-ABCDEF',
        metadata: {},
      },
      payat: {
        reference: 'intent-payat-1',
        paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
      },
    })

    const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
    const result = await createProviderPayatTopUpIntent(10_000)

    expect(result).toMatchObject({ ok: true })
    expect(createPayatTopUpIntent).toHaveBeenCalledWith({
      providerId: 'provider-1',
      amountCents: 10_000,
      providerCellphone: '+27821234567',
    })
  })

  describe('createProviderPayatTopUpIntent error classification', () => {
    it('returns TOO_MANY_PENDING when provider already has 3 pending intents', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(3)

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'TOO_MANY_PENDING' })
      expect(db.paymentIntent.count).toHaveBeenCalledWith({
        where: {
          providerId: 'provider-1',
          paymentMethod: 'PAYAT',
          status: { in: ['PENDING_PAYMENT', 'ITN_RECEIVED'] },
        },
      })
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
      const { PayatTokenError } = await import('../../lib/payat')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new PayatTokenError('fetch_failed', 401))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'PAYAT_TOKEN_FAILED' })
    })

    it('returns PAYAT_API_FAILED when RTP creation error is thrown', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      const { PayatApiError } = await import('../../lib/payat')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new PayatApiError('rtp_create_failed', 422))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'PAYAT_API_FAILED' })
    })

    it('returns PROVIDER_PHONE_MISSING with an actionable message when the profile has no phone', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent, ProviderCreditPaymentIntentError } = await import(
        '../../lib/provider-credit-payment-intents'
      )
      ;(createPayatTopUpIntent as any).mockRejectedValue(
        new ProviderCreditPaymentIntentError(
          'PROVIDER_PHONE_MISSING',
          'A mobile number is required on your provider profile to create a Pay@ payment link.',
        ),
      )

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'PROVIDER_PHONE_MISSING' })
      if (result.ok === false) {
        expect(result.userMessage).toContain('mobile number')
        expect(result.userMessage).toContain('profile')
      }
    })

    it('returns UNKNOWN for unrecognised errors', async () => {
      const { db } = await arrangeProvider()
      ;(db.paymentIntent.count as any).mockResolvedValue(0)
      const { createPayatTopUpIntent } = await import('../../lib/provider-credit-payment-intents')
      ;(createPayatTopUpIntent as any).mockRejectedValue(new Error('network error'))

      const { createProviderPayatTopUpIntent } = await import('../../app/(provider)/provider/credits/actions')
      const result = await createProviderPayatTopUpIntent(10_000)

      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' })
      if (result.ok === false) {
        expect(result.userMessage).toBe("We couldn’t create your Pay@ reference. Please try again.")
      }
    })
  })

  it('returns pending Pay@ intents with payment links from metadata', async () => {
    const { db } = await arrangeProvider()
    ;(db.paymentIntent.findMany as any).mockResolvedValue([
      {
        id: 'intent-payat-1',
        amountCents: 10_000,
        creditsToIssue: 2,
        paymentReference: 'PAT-ABCDEF',
        status: 'PENDING_PAYMENT',
        createdAt: new Date('2026-05-19T09:00:00.000Z'),
        expiresAt: new Date('2026-05-22T09:00:00.000Z'),
        metadata: { paymentLink: 'https://go.payat.co.za/pay/intent-payat-1' },
      },
    ])

    const { getProviderPendingIntents } = await import('../../app/(provider)/provider/credits/actions')
    await expect(getProviderPendingIntents()).resolves.toEqual([
      expect.objectContaining({
        id: 'intent-payat-1',
        paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
      }),
    ])
  })

  it('returns payment intent status with creditsIssued and stored payment link', async () => {
    const { db } = await arrangeProvider()
    ;(db.paymentIntent.findFirst as any).mockResolvedValue({
      status: 'CREDITED',
      paidAt: new Date('2026-05-19T09:01:00.000Z'),
      creditedAt: new Date('2026-05-19T09:02:00.000Z'),
      amountCents: 10_000,
      paymentReference: 'PAT-ABCDEF',
      creditsToIssue: 2,
      expiresAt: new Date('2026-05-22T09:00:00.000Z'),
      paymentMethod: 'PAYAT',
      metadata: { paymentLink: 'https://go.payat.co.za/pay/intent-payat-1' },
    })

    const { getPaymentIntentStatus } = await import('../../app/(provider)/provider/credits/actions')
    await expect(getPaymentIntentStatus('intent-payat-1')).resolves.toMatchObject({
      ok: true,
      status: 'CREDITED',
      creditsIssued: 2,
      paymentLink: 'https://go.payat.co.za/pay/intent-payat-1',
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

  describe('activity label and ref formatting', () => {
    async function arrangeWalletWithEntry(
      entryType: string,
      referenceType: string,
      referenceId: string,
      metadata: Record<string, unknown> = {},
      amountCredits = 1,
    ) {
      await arrangeProvider()
      const { getProviderWalletBalance, getProviderWalletLedgerEntries } = await import(
        '../../lib/provider-wallet'
      )
      ;(getProviderWalletBalance as any).mockResolvedValue({
        providerId: 'provider-1',
        paidCreditBalance: 2,
        promoCreditBalance: 1,
        totalCreditBalance: 3,
        status: 'ACTIVE',
      })
      ;(getProviderWalletLedgerEntries as any).mockResolvedValue([
        {
          id: 'entry-abc',
          entryType,
          creditType: 'PROMO',
          amountCredits,
          balanceAfterPaidCredits: 2,
          balanceAfterPromoCredits: 1,
          referenceType,
          referenceId,
          createdAt: new Date('2026-05-21T10:00:00.000Z'),
          metadata,
        },
      ])
    }

    it('VOUCHER_REDEMPTION shows "Voucher redeemed" with campaign in ref', async () => {
      await arrangeWalletWithEntry(
        'VOUCHER_REDEMPTION',
        'voucher',
        'voucher-id-00000001',
        { campaignCode: 'PILOT_MAY26', batchName: 'Pilot Flyer May 2026' },
      )
      const { getProviderWallet } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const wallet = await getProviderWallet()
      expect(wallet.recentActivity[0].title).toBe('Voucher redeemed')
      expect(wallet.recentActivity[0].ref).toContain('PILOT_MAY26')
      expect(wallet.recentActivity[0].delta).toBe(1)
      expect(wallet.recentActivity[0].entryType).toBe('VOUCHER_REDEMPTION')
    })

    it('LEAD_UNLOCK_DEBIT shows "Lead accepted" with category in ref', async () => {
      await arrangeWalletWithEntry(
        'LEAD_UNLOCK_DEBIT',
        'lead_unlock',
        'unlock-id-00000001',
        { jobCategory: 'Plumbing', jobTitle: 'Blocked drain', leadRef: '0000001' },
      )
      const { getProviderWallet } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const wallet = await getProviderWallet()
      expect(wallet.recentActivity[0].title).toBe('Lead accepted')
      expect(wallet.recentActivity[0].ref).toContain('Plumbing')
      expect(wallet.recentActivity[0].delta).toBe(-1)
    })

    it('PROMO_CREDIT shows "Starter credits added" with welcome allocation ref', async () => {
      await arrangeWalletWithEntry(
        'PROMO_CREDIT',
        'provider_promo_award',
        'award-id-00000001',
        { awardType: 'MOBILE_VERIFIED' },
      )
      const { getProviderWallet } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const wallet = await getProviderWallet()
      expect(wallet.recentActivity[0].title).toBe('Starter credits added')
      expect(wallet.recentActivity[0].ref).toBe('Welcome allocation')
      expect(wallet.recentActivity[0].delta).toBe(1)
    })

    it('PROMO_EXPIRY shows "Starter credits expired" as a debit', async () => {
      await arrangeWalletWithEntry(
        'PROMO_EXPIRY',
        'system',
        'ref-id-00000001',
        {},
      )
      const { getProviderWallet } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const wallet = await getProviderWallet()
      expect(wallet.recentActivity[0].title).toBe('Starter credits expired')
      expect(wallet.recentActivity[0].delta).toBe(-1)
    })

    it('WALLET_SUSPENDED shows "Wallet suspended" with delta of 0 (status-only entry)', async () => {
      await arrangeWalletWithEntry(
        'WALLET_SUSPENDED',
        'admin',
        'admin-case-00000001',
        {},
        0,
      )
      const { getProviderWallet } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const wallet = await getProviderWallet()
      expect(wallet.recentActivity[0].title).toBe('Wallet suspended')
      expect(wallet.recentActivity[0].delta).toBe(0)
    })
  })

  describe('getProviderWalletLedgerEntry', () => {
    it('returns full transaction detail for the authenticated provider', async () => {
      const { db } = await arrangeProvider()
      ;(db as any).walletLedgerEntry = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry-xyz',
          entryType: 'VOUCHER_REDEMPTION',
          creditType: 'PROMO',
          amountCredits: 3,
          balanceAfterPaidCredits: 0,
          balanceAfterPromoCredits: 3,
          referenceType: 'voucher',
          referenceId: 'voucher-id-00000002',
          description: 'Voucher redemption — 3 credits',
          source: 'voucher_redemption',
          createdAt: new Date('2026-05-21T10:00:00.000Z'),
          metadata: {
            campaignCode: 'PILOT_MAY26',
            batchName: 'Pilot Flyer May 2026',
            balanceBeforePaidCredits: 0,
            balanceBeforePromoCredits: 0,
          },
        }),
      }

      const { getProviderWalletLedgerEntry } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const detail = await getProviderWalletLedgerEntry('entry-xyz')

      expect(detail).not.toBeNull()
      expect(detail!.title).toBe('Voucher redeemed')
      expect(detail!.signedAmountCredits).toBe(3)
      expect(detail!.relatedVoucherCampaign).toBe('PILOT_MAY26')
      expect(detail!.relatedVoucherBatchName).toBe('Pilot Flyer May 2026')
      expect(detail!.balanceBeforePaidCredits).toBe(0)
      expect(detail!.balanceAfterPromoCredits).toBe(3)
    })

    it('returns null when entry does not belong to the authenticated provider', async () => {
      const { db } = await arrangeProvider()
      ;(db as any).walletLedgerEntry = {
        findFirst: vi.fn().mockResolvedValue(null),
      }

      const { getProviderWalletLedgerEntry } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      await expect(getProviderWalletLedgerEntry('entry-other')).resolves.toBeNull()
    })

    it('LEAD_UNLOCK_DEBIT detail includes job category, title, and lead ref from metadata', async () => {
      const { db } = await arrangeProvider()
      ;(db as any).walletLedgerEntry = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry-lead',
          entryType: 'LEAD_UNLOCK_DEBIT',
          creditType: 'PAID',
          amountCredits: 1,
          balanceAfterPaidCredits: 4,
          balanceAfterPromoCredits: 0,
          referenceType: 'lead_unlock',
          referenceId: 'unlock-id-00000099',
          description: null,
          source: 'system',
          createdAt: new Date('2026-05-21T11:00:00.000Z'),
          metadata: {
            jobCategory: 'Plumbing',
            jobTitle: 'Blocked drain',
            leadRef: 'ABC12345',
            balanceBeforePaidCredits: 5,
            balanceBeforePromoCredits: 0,
          },
        }),
      }

      const { getProviderWalletLedgerEntry } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const detail = await getProviderWalletLedgerEntry('entry-lead')

      expect(detail).not.toBeNull()
      expect(detail!.title).toBe('Lead accepted')
      expect(detail!.signedAmountCredits).toBe(-1)
      expect(detail!.relatedJobCategory).toBe('Plumbing')
      expect(detail!.relatedJobTitle).toBe('Blocked drain')
      expect(detail!.relatedJobRef).toBe('ABC12345')
      expect(detail!.balanceBeforePaidCredits).toBe(5)
      expect(detail!.balanceAfterPaidCredits).toBe(4)
    })

    it('WALLET_SUSPENDED entry has zero signedAmountCredits and correct title', async () => {
      const { db } = await arrangeProvider()
      ;(db as any).walletLedgerEntry = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry-suspended',
          entryType: 'WALLET_SUSPENDED',
          creditType: 'PAID',
          amountCredits: 0,
          balanceAfterPaidCredits: 5,
          balanceAfterPromoCredits: 2,
          referenceType: 'admin',
          referenceId: 'admin-case-00000001',
          description: 'Account suspended pending review',
          source: 'admin',
          createdAt: new Date('2026-05-21T12:00:00.000Z'),
          metadata: { balanceBeforePaidCredits: 5, balanceBeforePromoCredits: 2 },
        }),
      }

      const { getProviderWalletLedgerEntry } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const detail = await getProviderWalletLedgerEntry('entry-suspended')

      expect(detail).not.toBeNull()
      expect(detail!.title).toBe('Wallet suspended')
      expect(detail!.signedAmountCredits).toBe(0)
      expect(detail!.balanceBeforePaidCredits).toBe(5)
      expect(detail!.balanceAfterPaidCredits).toBe(5)
    })

    it('legacy entry with null metadata does not crash and returns null relatedJob fields', async () => {
      const { db } = await arrangeProvider()
      ;(db as any).walletLedgerEntry = {
        findFirst: vi.fn().mockResolvedValue({
          id: 'entry-legacy',
          entryType: 'LEAD_UNLOCK_DEBIT',
          creditType: 'PAID',
          amountCredits: 1,
          balanceAfterPaidCredits: 2,
          balanceAfterPromoCredits: 0,
          referenceType: 'lead',
          referenceId: 'legacy-ref-00000001',
          description: null,
          source: null,
          createdAt: new Date('2026-05-01T09:00:00.000Z'),
          metadata: null,
        }),
      }

      const { getProviderWalletLedgerEntry } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const detail = await getProviderWalletLedgerEntry('entry-legacy')

      expect(detail).not.toBeNull()
      expect(detail!.title).toBe('Lead accepted')
      expect(detail!.signedAmountCredits).toBe(-1)
      expect(detail!.relatedJobCategory).toBeNull()
      expect(detail!.relatedJobTitle).toBeNull()
      expect(detail!.relatedJobRef).toBeNull()
      expect(detail!.balanceBeforePaidCredits).toBeNull()
      expect(detail!.balanceBeforePromoCredits).toBeNull()
    })
  })

  describe('getProviderWalletLedgerPage', () => {
    it('returns first page of items with nextCursor when more exist', async () => {
      const { db } = await arrangeProvider()
      const entries = Array.from({ length: 26 }, (_, i) => ({
        id: `entry-${i}`,
        entryType: 'LEAD_UNLOCK_DEBIT',
        creditType: 'PROMO',
        amountCredits: 1,
        balanceAfterPaidCredits: 10 - i,
        balanceAfterPromoCredits: 0,
        referenceType: 'lead_unlock',
        referenceId: `unlock-${i}`,
        createdAt: new Date(`2026-05-21T10:${String(i).padStart(2, '0')}:00.000Z`),
        metadata: { jobCategory: 'Plumbing' },
      }))
      ;(db as any).walletLedgerEntry = {
        findMany: vi.fn().mockResolvedValue(entries),
      }

      const { getProviderWalletLedgerPage } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const result = await getProviderWalletLedgerPage({ filter: 'all' })

      expect(result.items).toHaveLength(25)
      expect(result.nextCursor).toBe('entry-24')
    })

    it('returns null nextCursor when all items fit in one page', async () => {
      const { db } = await arrangeProvider()
      ;(db as any).walletLedgerEntry = {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'entry-0',
            entryType: 'PROMO_CREDIT',
            creditType: 'PROMO',
            amountCredits: 3,
            balanceAfterPaidCredits: 0,
            balanceAfterPromoCredits: 3,
            referenceType: 'provider_promo_award',
            referenceId: 'award-0',
            createdAt: new Date('2026-05-21T10:00:00.000Z'),
            metadata: { awardType: 'MOBILE_VERIFIED' },
          },
        ]),
      }

      const { getProviderWalletLedgerPage } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      const result = await getProviderWalletLedgerPage({ filter: 'all' })

      expect(result.items).toHaveLength(1)
      expect(result.nextCursor).toBeNull()
    })

    it('passes entryType filter for "used" to the database query', async () => {
      const { db } = await arrangeProvider()
      const findMany = vi.fn().mockResolvedValue([])
      ;(db as any).walletLedgerEntry = { findMany }

      const { getProviderWalletLedgerPage } = await import(
        '../../app/(provider)/provider/credits/actions'
      )
      await getProviderWalletLedgerPage({ filter: 'used' })

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entryType: { in: expect.arrayContaining(['LEAD_UNLOCK_DEBIT']) },
          }),
        }),
      )
    })
  })
})
