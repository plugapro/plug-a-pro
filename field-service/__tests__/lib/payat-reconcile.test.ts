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

    expect(result).toEqual({ action: 'not_paid', internalStatus: 'PAID' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('does not credit while payment is still outstanding', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'SENT', amountPaidCents: 0 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'not_paid', internalStatus: 'SENT' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('skips intents with no clientAccountNumber instead of throwing', async () => {
    findUnique.mockResolvedValue({
      id: 'legacy', amountCents: 10000, clientAccountNumber: null,
      status: 'PENDING_PAYMENT', creditedAt: null,
    })

    const result = await reconcilePayatIntent('legacy')

    expect(result).toEqual({ action: 'skipped', reason: 'no clientAccountNumber' })
    expect(readPayatSingleRtp).not.toHaveBeenCalled()
  })

  it('skips an already-credited intent without calling Pay@', async () => {
    findUnique.mockResolvedValue({
      id: 'intent-1', amountCents: 10000, clientAccountNumber: '12345678901234',
      status: 'CREDITED', creditedAt: new Date(),
    })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'skipped', reason: 'already credited' })
    expect(readPayatSingleRtp).not.toHaveBeenCalled()
  })
})
