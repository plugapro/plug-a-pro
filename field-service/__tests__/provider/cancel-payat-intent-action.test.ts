import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockRequireProvider, mockDb, mockRevalidatePath } = vi.hoisted(() => ({
  mockRequireProvider: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    provider: { findUnique: vi.fn() },
    paymentIntent: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockRevalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireProvider: mockRequireProvider }))
vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/provider-wallet', () => ({
  getProviderWalletBalance: vi.fn(),
  getProviderWalletLedgerEntries: vi.fn(),
}))
vi.mock('@/lib/provider-credit-payment-intents', () => ({
  createPayatTopUpIntent: vi.fn(),
  createManualEftTopUpIntent: vi.fn(),
  getManualEftBankAccountInstructions: vi.fn(),
  ProviderCreditPaymentIntentError: class ProviderCreditPaymentIntentError extends Error {
    code: string
    constructor(code: string, msg: string) { super(msg); this.code = code }
  },
}))
vi.mock('@/lib/payat', () => ({
  PayatConfigError: class PayatConfigError extends Error {},
  PayatApiError: class PayatApiError extends Error {},
  PayatTokenError: class PayatTokenError extends Error {},
}))
vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyProviderPayatTopUpInitiated: vi.fn(),
}))
vi.mock('@/lib/identity-verification/link', () => ({
  issueProviderIdentityVerificationLink: vi.fn(),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(false) }))

// ─── Test helpers ─────────────────────────────────────────────────────────────

const PROVIDER_ID = 'provider-abc'
const INTENT_ID = 'intent-xyz'

function setupAuth() {
  mockRequireProvider.mockResolvedValue({ id: 'user-1', phone: '+27821234567' })
  mockDb.provider.findUnique.mockResolvedValue({ id: PROVIDER_ID, phone: '+27821234567' })
}

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { payAtAmountCents: 10_000 },
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('cancelProviderPayatTopUpIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setupAuth()

    // Default: transaction executes the callback
    mockDb.$transaction.mockImplementation(async (cb: (tx: typeof mockDb) => unknown) =>
      cb(mockDb as unknown as typeof mockDb),
    )

    // Default: intent found (PENDING_PAYMENT, owned by provider)
    mockDb.paymentIntent.findFirst.mockResolvedValue(makeIntent())
    mockDb.paymentIntent.update.mockResolvedValue({})
    // Default: atomic cancel transition succeeds (count === 1).
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 1 })
  })

  it('transitions a PENDING_PAYMENT intent to CANCELLED and stamps cancelledAt metadata', async () => {
    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )

    const result = await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(result).toEqual({ ok: true })

    expect(mockDb.paymentIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INTENT_ID,
          providerId: PROVIDER_ID,
          paymentMethod: 'PAYAT',
          status: 'PENDING_PAYMENT',
        }),
      }),
    )

    // Atomic, predicate-guarded transition (status PENDING_PAYMENT + creditedAt null)
    // so a concurrent webhook cannot be clobbered back to CANCELLED.
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INTENT_ID,
          providerId: PROVIDER_ID,
          paymentMethod: 'PAYAT',
          status: 'PENDING_PAYMENT',
          creditedAt: null,
        }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          metadata: expect.objectContaining({
            cancelledBy: 'provider',
            cancelledAt: expect.any(String),
          }),
        }),
      }),
    )
  })

  it('revalidates credits paths on success', async () => {
    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )

    await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(mockRevalidatePath).toHaveBeenCalledWith('/provider/credits')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/provider/credits/pending')
  })

  it('preserves existing metadata keys alongside the cancel stamp', async () => {
    mockDb.paymentIntent.findFirst.mockResolvedValue(
      makeIntent({ metadata: { payAtAmountCents: 20_000, someOtherKey: 'value' } }),
    )

    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            payAtAmountCents: 20_000,
            someOtherKey: 'value',
            cancelledBy: 'provider',
          }),
        }),
      }),
    )
  })

  it('returns FORBIDDEN when provider session cannot be resolved', async () => {
    mockRequireProvider.mockRejectedValue(new Error('Not authenticated'))

    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const result = await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('returns NOT_CANCELLABLE when intent is not found (wrong id or wrong provider)', async () => {
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)

    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const result = await cancelProviderPayatTopUpIntent('intent-does-not-exist')

    expect(result).toMatchObject({ ok: false, code: 'NOT_CANCELLABLE' })
    expect(mockDb.paymentIntent.update).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns NOT_CANCELLABLE when intent belongs to a different provider', async () => {
    // The where clause in findFirst includes providerId: actor.id,
    // so a different provider's intent returns null.
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)

    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const result = await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(result).toMatchObject({ ok: false, code: 'NOT_CANCELLABLE' })
  })

  it('returns NOT_CANCELLABLE for a non-PENDING_PAYMENT intent (the where clause blocks it)', async () => {
    // The transaction findFirst uses status: 'PENDING_PAYMENT' -
    // CREDITED / ITN_RECEIVED / EXPIRED intents will not match.
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)

    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const result = await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(result).toMatchObject({ ok: false, code: 'NOT_CANCELLABLE' })
    expect(mockDb.paymentIntent.update).not.toHaveBeenCalled()
  })

  it('does not revalidate paths when cancellation fails', async () => {
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)

    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    await cancelProviderPayatTopUpIntent(INTENT_ID)

    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe('cancelProviderPayatTopUpIntent - duplicate guard interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setupAuth()
    mockDb.$transaction.mockImplementation(async (cb: (tx: typeof mockDb) => unknown) =>
      cb(mockDb as unknown as typeof mockDb),
    )
    mockDb.paymentIntent.findFirst.mockResolvedValue(makeIntent())
    mockDb.paymentIntent.update.mockResolvedValue({})
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 1 })
  })

  it('succeeds (enabling a fresh intent for the same amount after cancellation)', async () => {
    const { cancelProviderPayatTopUpIntent } = await import(
      '../../app/(provider)/provider/credits/actions'
    )
    const result = await cancelProviderPayatTopUpIntent(INTENT_ID)

    // A CANCELLED intent no longer matches the duplicate-intent guard
    // (which checks status: 'PENDING_PAYMENT'), so a new intent can be created.
    expect(result).toEqual({ ok: true })
  })
})
