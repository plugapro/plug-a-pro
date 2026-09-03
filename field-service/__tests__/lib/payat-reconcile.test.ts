import { describe, it, expect, vi, beforeEach } from 'vitest'

const readPayatSingleRtp = vi.fn()
const creditProviderWalletFromPayatWebhook = vi.fn()
const findUnique = vi.fn()

vi.mock('@/lib/payat/read', () => ({ readPayatSingleRtp }))
vi.mock('@/lib/provider-credit-gateway-itn', () => ({ creditProviderWalletFromPayatWebhook }))
vi.mock('@/lib/db', () => ({ db: { paymentIntent: { findUnique } } }))

const { reconcilePayatIntent } = await import('@/lib/payat/reconcile')

describe('reconcilePayatIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue({
      id: 'intent-1',
      amountCents: 10000,
      metadata: null,
      clientAccountNumber: '12345678901234',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
    })
  })

  it('credits when Pay@ reports PAID for at least the intent amount', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 10000 })
    creditProviderWalletFromPayatWebhook.mockResolvedValue({ credited: true, ledgerEntryId: 'led-1' })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'credited', ledgerEntryId: 'led-1' })
  })

  it('does NOT credit an underpayment even when Pay@ reports PAID', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 500 })

    const result = await reconcilePayatIntent('intent-1')

    // PAID with an amount that does not cover the request is NOT a confirmed
    // non-payment - it is unconfirmable. The caller must not expire on it.
    expect(result).toEqual({
      action: 'indeterminate',
      internalStatus: 'PAID',
      expectedAmountCents: 10000,
      amountPaidCents: 500,
    })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('does not credit while payment is still outstanding', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'SENT', amountPaidCents: 0 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'not_paid', internalStatus: 'SENT' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it.each(['SENT', 'EXPIRED', 'CANCELLED'] as const)(
    'reports %s as confirmed not_paid - the only states an expiry may act on',
    async (internalStatus) => {
      readPayatSingleRtp.mockResolvedValue({ internalStatus, amountPaidCents: 0 })

      const result = await reconcilePayatIntent('intent-1')

      expect(result).toEqual({ action: 'not_paid', internalStatus })
      expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
    },
  )

  it('reports PAID with a null paid amount as indeterminate, never not_paid', async () => {
    // The shape that would strand a real payment: Pay@ says PAID but the amount
    // field is missing or unparseable, so we cannot confirm it.
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: null })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({
      action: 'indeterminate',
      internalStatus: 'PAID',
      expectedAmountCents: 10000,
      amountPaidCents: null,
    })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('reports PAID reported in rands ("350.00" -> 350) as indeterminate rather than unpaid', async () => {
    // read.ts parses "350.00" to 350; the intent wants 35000 cents. Treating
    // that as not_paid would let the sweep expire a payment that really
    // happened. No magnitude heuristic is applied - it is simply unconfirmed.
    findUnique.mockResolvedValue({
      id: 'intent-1', amountCents: 35000, metadata: null,
      clientAccountNumber: '12345678901234', status: 'PENDING_PAYMENT', creditedAt: null,
    })
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 350 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toMatchObject({ action: 'indeterminate', internalStatus: 'PAID' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('reports FAILED as indeterminate - PARTIAL_PAYMENT_RECEIVED means money reached a till', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'FAILED', amountPaidCents: 500 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toMatchObject({ action: 'indeterminate', internalStatus: 'FAILED' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('reports an unmapped state as indeterminate rather than assuming no payment', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'UNKNOWN', amountPaidCents: null })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toMatchObject({ action: 'indeterminate', internalStatus: 'UNKNOWN' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('credits against the fee-inclusive payAtAmountCents from metadata', async () => {
    findUnique.mockResolvedValue({
      id: 'intent-1', amountCents: 10000, metadata: { payAtAmountCents: 10700 },
      clientAccountNumber: '12345678901234', status: 'PENDING_PAYMENT', creditedAt: null,
    })
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 10700 })
    creditProviderWalletFromPayatWebhook.mockResolvedValue({ credited: true, ledgerEntryId: 'led-1' })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'credited', ledgerEntryId: 'led-1' })
  })

  it('does NOT credit a payment matching the credit value but not the fee-inclusive amount', async () => {
    // Mirrors the legacy webhook guard (payat-webhook.test.ts C-2): the amount
    // requested from Pay@ is amountCents + feeAmountCents, so 10000 against a
    // 10700 request is short.
    findUnique.mockResolvedValue({
      id: 'intent-1', amountCents: 10000, metadata: { payAtAmountCents: 10700 },
      clientAccountNumber: '12345678901234', status: 'PENDING_PAYMENT', creditedAt: null,
    })
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 10000 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({
      action: 'indeterminate',
      internalStatus: 'PAID',
      expectedAmountCents: 10700,
      amountPaidCents: 10000,
    })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('skips intents with no clientAccountNumber instead of throwing', async () => {
    findUnique.mockResolvedValue({
      id: 'legacy', amountCents: 10000, metadata: null, clientAccountNumber: null,
      status: 'PENDING_PAYMENT', creditedAt: null,
    })

    const result = await reconcilePayatIntent('legacy')

    expect(result).toEqual({ action: 'skipped', reason: 'no clientAccountNumber' })
    expect(readPayatSingleRtp).not.toHaveBeenCalled()
  })

  it('skips an already-credited intent without calling Pay@', async () => {
    findUnique.mockResolvedValue({
      id: 'intent-1', amountCents: 10000, metadata: null, clientAccountNumber: '12345678901234',
      status: 'CREDITED', creditedAt: new Date(),
    })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'skipped', reason: 'already credited' })
    expect(readPayatSingleRtp).not.toHaveBeenCalled()
  })
})
