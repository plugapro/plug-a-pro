import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))

const { mockDb } = vi.hoisted(() => ({
  mockDb: { $transaction: vi.fn() },
}))
vi.mock('../../lib/db', () => ({ db: mockDb }))

const { mockDebit, MockProviderWalletError } = vi.hoisted(() => {
  class MockProviderWalletError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'ProviderWalletError'
    }
  }
  return { mockDebit: vi.fn(), MockProviderWalletError }
})
vi.mock('../../lib/provider-wallet', () => ({
  debitPaidCreditsForKycFeeInTransaction: mockDebit,
  ProviderWalletError: MockProviderWalletError,
}))

import { settleOutstandingKycFeeAfterTopUp } from '../../lib/kyc-fee/recovery'

type FeeRow = {
  id: string
  providerId: string
  reason: string
  amountCents: number
  balanceAfterCents: number
  idempotencyKey?: string | null
}

function makeTx(rows: FeeRow[]) {
  const created: Array<Record<string, unknown>> = []
  const tx = {
    kycFeeLedgerEntry: {
      findFirst: vi.fn(async () => (rows.length ? rows[rows.length - 1] : null)),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row = { id: `fee-${created.length + 1}`, ...args.data }
        created.push(row)
        return row
      }),
    },
  }
  return { tx, created }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'provider-1',
    paymentIntentId: 'intent-1',
    createdBy: 'payat-webhook',
    ...overrides,
  }
}

describe('settleOutstandingKycFeeAfterTopUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockDebit.mockResolvedValue({
      wallet: { paidCreditBalance: 1, promoCreditBalance: 0 },
      ledgerEntries: [{ id: 'wallet-entry-1' }],
    })
  })

  it('returns FLAG_OFF without opening a transaction when the fee flag is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)

    const result = await settleOutstandingKycFeeAfterTopUp(input())

    expect(result).toEqual({ outcome: 'FLAG_OFF' })
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('returns NO_OUTSTANDING_FEE when the provider owes nothing', async () => {
    const { tx } = makeTx([])
    mockDb.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    const result = await settleOutstandingKycFeeAfterTopUp(input())

    expect(result).toEqual({ outcome: 'NO_OUTSTANDING_FEE' })
    expect(mockDebit).not.toHaveBeenCalled()
  })

  it('debits 1 paid credit and writes an idempotent KYC_FEE_RECOVERED row for an R50 debt', async () => {
    const { tx, created } = makeTx([
      {
        id: 'fee-accrued',
        providerId: 'provider-1',
        reason: 'KYC_FEE_ACCRUED',
        amountCents: 5000,
        balanceAfterCents: 5000,
      },
    ])
    mockDb.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    const result = await settleOutstandingKycFeeAfterTopUp(input())

    expect(result).toMatchObject({
      outcome: 'RECOVERED',
      creditsDeducted: 1,
      amountCents: 5000,
    })
    expect(mockDebit).toHaveBeenCalledWith(
      tx,
      'provider-1',
      1,
      expect.objectContaining({
        referenceType: 'payment_intent',
        referenceId: 'intent-1',
      }),
    )
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      reason: 'KYC_FEE_RECOVERED',
      amountCents: 5000,
      balanceAfterCents: 0,
      idempotencyKey: 'kyc-fee-recovered:provider-1',
      referenceType: 'payment_intent',
      referenceId: 'intent-1',
    })
  })

  it('skips legacy debts that are not a whole multiple of the credit price', async () => {
    const { tx } = makeTx([
      {
        id: 'fee-accrued',
        providerId: 'provider-1',
        reason: 'KYC_FEE_ACCRUED',
        amountCents: 2000,
        balanceAfterCents: 2000,
      },
    ])
    mockDb.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    const result = await settleOutstandingKycFeeAfterTopUp(input())

    expect(result).toEqual({ outcome: 'SKIPPED_LEGACY_AMOUNT', outstandingCents: 2000 })
    expect(mockDebit).not.toHaveBeenCalled()
  })

  it('maps a P2002 idempotency collision to ALREADY_RECOVERED', async () => {
    const { tx } = makeTx([
      {
        id: 'fee-accrued',
        providerId: 'provider-1',
        reason: 'KYC_FEE_ACCRUED',
        amountCents: 5000,
        balanceAfterCents: 5000,
      },
    ])
    tx.kycFeeLedgerEntry.create.mockRejectedValue(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    )
    mockDb.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    const result = await settleOutstandingKycFeeAfterTopUp(input())

    expect(result).toEqual({ outcome: 'ALREADY_RECOVERED' })
  })

  it('returns FAILED instead of throwing when the wallet debit fails', async () => {
    const { tx, created } = makeTx([
      {
        id: 'fee-accrued',
        providerId: 'provider-1',
        reason: 'KYC_FEE_ACCRUED',
        amountCents: 5000,
        balanceAfterCents: 5000,
      },
    ])
    mockDb.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))
    mockDebit.mockRejectedValue(
      new MockProviderWalletError('INSUFFICIENT_FUNDS', 'not enough paid credits'),
    )

    const result = await settleOutstandingKycFeeAfterTopUp(input())

    expect(result).toMatchObject({ outcome: 'FAILED' })
    expect(created).toHaveLength(0)
  })
})
