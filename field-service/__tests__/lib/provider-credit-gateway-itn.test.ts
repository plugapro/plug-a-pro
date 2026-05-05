/**
 * Tests for the gateway ITN crediting service.
 *
 * Verifies idempotency, correct ledger entry creation, wallet balance
 * increments, and that post-credit notifications fire outside the transaction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDb, walletState } = vi.hoisted(() => {
  const walletState = {
    intent: null as Record<string, unknown> | null,
    wallet: null as Record<string, unknown> | null,
    ledgerEntries: [] as Record<string, unknown>[],
  }

  const mockDb = {
    $transaction: vi.fn(),
    paymentIntent: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    providerWallet: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
    },
  }

  return { mockDb, walletState }
})

const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockAwardPromo = vi.hoisted(() => vi.fn().mockResolvedValue({
  award: null,
  wallet: null,
  ledgerEntries: [],
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/provider-wallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/provider-wallet')>()
  return {
    ...actual,
    creditPaidCreditsInTransaction: vi.fn().mockImplementation(
      async (_tx: unknown, _providerId: string, amountCredits: number, _ref: unknown) => {
        const wallet = walletState.wallet!
        const updatedWallet = {
          ...wallet,
          paidCreditBalance: (wallet.paidCreditBalance as number) + amountCredits,
        }
        walletState.wallet = updatedWallet
        const entry = {
          id: `entry-${walletState.ledgerEntries.length + 1}`,
          entryType: 'TOPUP_CREDIT',
          creditType: 'PAID',
          amountCredits,
          balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
          balanceAfterPromoCredits: wallet.promoCreditBalance,
        }
        walletState.ledgerEntries.push(entry)
        return { wallet: updatedWallet, ledgerEntries: [entry] }
      },
    ),
  }
})

vi.mock('@/lib/provider-promo-awards', () => ({
  awardFirstTopUpPromoCreditsInTransaction: mockAwardPromo,
}))

vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentCredited: mockNotify,
}))

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    providerId: 'provider-1',
    amountCents: 10_000,
    creditsToIssue: 2,
    paymentReference: 'PF-AABBCC',
    status: 'ITN_RECEIVED',
    creditedAt: null,
    itnPaymentStatus: 'COMPLETE',
    provider: { isTestUser: false, cohortName: null },
    ...overrides,
  }
}

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    providerId: 'provider-1',
    paidCreditBalance: 0,
    promoCreditBalance: 0,
    status: 'ACTIVE',
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('creditProviderWalletFromGatewayItn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    walletState.intent = makeIntent()
    walletState.wallet = makeWallet()
    walletState.ledgerEntries = []

    mockDb.paymentIntent.findUnique.mockImplementation(async () => walletState.intent)

    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) => {
      return callback(mockDb as unknown as typeof mockDb)
    })

    // updateMany: simulate the optimistic lock — returns count=1 on first call.
    mockDb.paymentIntent.updateMany.mockImplementation(async (args: Record<string, unknown>) => {
      const data = args.data as Record<string, unknown>
      if (walletState.intent && walletState.intent.creditedAt === null) {
        walletState.intent = {
          ...walletState.intent,
          status: data.status,
          creditedAt: data.creditedAt,
        }
        return { count: 1 }
      }
      return { count: 0 }
    })

    mockDb.paymentIntent.update.mockImplementation(async (args: Record<string, unknown>) => {
      const data = args.data as Record<string, unknown>
      walletState.intent = { ...walletState.intent!, ...data }
      return walletState.intent
    })
  })

  it('credits wallet with correct paid credits for a valid ITN_RECEIVED intent', async () => {
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    const result = await creditProviderWalletFromGatewayItn('intent-1')

    expect(result).toMatchObject({ credited: true })
    expect(walletState.wallet!.paidCreditBalance).toBe(2)
  })

  it('creates a ledger entry with correct fields', async () => {
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    await creditProviderWalletFromGatewayItn('intent-1')

    expect(walletState.ledgerEntries).toHaveLength(1)
    expect(walletState.ledgerEntries[0]).toMatchObject({
      entryType: 'TOPUP_CREDIT',
      creditType: 'PAID',
      amountCredits: 2,
      balanceAfterPaidCredits: 2,
    })
  })

  it('marks the intent as CREDITED', async () => {
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    await creditProviderWalletFromGatewayItn('intent-1')

    expect(walletState.intent!.status).toBe('CREDITED')
    expect(walletState.intent!.creditedAt).toBeTruthy()
  })

  it('returns credited: false when intent is not found', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    const result = await creditProviderWalletFromGatewayItn('nonexistent')
    expect(result).toMatchObject({ credited: false, reason: 'intent not found' })
  })

  it('returns credited: false when intent is already CREDITED (idempotency)', async () => {
    walletState.intent = makeIntent({ status: 'CREDITED', creditedAt: new Date() })
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    const result = await creditProviderWalletFromGatewayItn('intent-1')
    expect(result).toMatchObject({ credited: false, reason: 'already credited' })
  })

  it('does not increment wallet balance on second call for same intent', async () => {
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    await creditProviderWalletFromGatewayItn('intent-1')
    // Now intent is CREDITED — second call should be no-op.
    const second = await creditProviderWalletFromGatewayItn('intent-1')
    expect(second).toMatchObject({ credited: false })
    // Balance still 2, not 4.
    expect(walletState.wallet!.paidCreditBalance).toBe(2)
  })

  it('emits a WhatsApp notification after successful credit', async () => {
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    await creditProviderWalletFromGatewayItn('intent-1')
    // Notification is async fire-and-forget; wait a tick.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockNotify).toHaveBeenCalledWith('intent-1')
  })

  it('does not emit notification when already credited', async () => {
    walletState.intent = makeIntent({ status: 'CREDITED', creditedAt: new Date() })
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    await creditProviderWalletFromGatewayItn('intent-1')
    await new Promise((r) => setTimeout(r, 0))
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('calls awardFirstTopUpPromoCreditsInTransaction inside the transaction', async () => {
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    await creditProviderWalletFromGatewayItn('intent-1')
    expect(mockAwardPromo).toHaveBeenCalledWith(
      expect.anything(),
      'provider-1',
      'intent-1',
      'payfast-itn',
    )
  })

  it('returns credited: false for a non-creditable intent status', async () => {
    walletState.intent = makeIntent({ status: 'FAILED' })
    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )
    const result = await creditProviderWalletFromGatewayItn('intent-1')
    expect(result).toMatchObject({ credited: false, reason: expect.stringContaining('FAILED') })
  })

  it('handles concurrent duplicate calls via the updateMany lock', async () => {
    // First call acquires the lock (count=1). Second concurrent call gets count=0.
    let callCount = 0
    mockDb.paymentIntent.updateMany.mockImplementation(async () => {
      callCount += 1
      if (callCount === 1) return { count: 1 }
      return { count: 0 }
    })

    const { creditProviderWalletFromGatewayItn } = await import(
      '../../lib/provider-credit-gateway-itn'
    )

    const [first, second] = await Promise.all([
      creditProviderWalletFromGatewayItn('intent-1'),
      creditProviderWalletFromGatewayItn('intent-1'),
    ])

    const creditedCount = [first, second].filter((r) => r.credited).length
    expect(creditedCount).toBe(1)
  })
})
