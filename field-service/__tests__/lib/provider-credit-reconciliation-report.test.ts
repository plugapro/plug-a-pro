import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildProviderCreditReconciliationReport } from '../../lib/provider-credit-reconciliation-report'

const { mockDb, state } = vi.hoisted(() => {
  const state: { provider: any } = { provider: null }
  const mockDb = {
    provider: {
      findUnique: vi.fn(),
    },
  }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

function ledgerEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ledger-1',
    walletId: 'wallet-1',
    providerId: 'provider-1',
    entryType: 'PROMO_CREDIT',
    creditType: 'PROMO',
    amountCredits: 3,
    isTestTransaction: false,
    cohortName: null,
    balanceAfterPaidCredits: 0,
    balanceAfterPromoCredits: 3,
    referenceType: 'provider_promo_award',
    referenceId: 'award-1',
    description: null,
    metadata: {},
    createdAt: new Date('2026-04-30T10:00:00.000Z'),
    createdBy: 'admin-1',
    ...overrides,
  }
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    isTestUser: false,
    cohortName: null,
    wallet: {
      id: 'wallet-1',
      providerId: 'provider-1',
      paidCreditBalance: 4,
      promoCreditBalance: 2,
      status: 'ACTIVE',
    },
    walletLedgerEntries: [
      ledgerEntry({
        id: 'ledger-award',
        entryType: 'PROMO_CREDIT',
        creditType: 'PROMO',
        amountCredits: 3,
        balanceAfterPaidCredits: 0,
        balanceAfterPromoCredits: 3,
        referenceType: 'provider_promo_award',
        referenceId: 'award-1',
      }),
      ledgerEntry({
        id: 'ledger-topup',
        entryType: 'TOPUP_CREDIT',
        creditType: 'PAID',
        amountCredits: 5,
        balanceAfterPaidCredits: 5,
        balanceAfterPromoCredits: 3,
        referenceType: 'payment_intent',
        referenceId: 'intent-1',
      }),
      ledgerEntry({
        id: 'ledger-unlock-promo',
        entryType: 'LEAD_UNLOCK_DEBIT',
        creditType: 'PROMO',
        amountCredits: 1,
        balanceAfterPaidCredits: 5,
        balanceAfterPromoCredits: 2,
        referenceType: 'lead_unlock',
        referenceId: 'unlock-1',
      }),
      ledgerEntry({
        id: 'ledger-unlock-paid',
        entryType: 'LEAD_UNLOCK_DEBIT',
        creditType: 'PAID',
        amountCredits: 1,
        balanceAfterPaidCredits: 4,
        balanceAfterPromoCredits: 2,
        referenceType: 'lead_unlock',
        referenceId: 'unlock-2',
      }),
    ],
    paymentIntents: [{
      id: 'intent-1',
      status: 'CREDITED',
      creditedAt: new Date('2026-04-30T10:05:00.000Z'),
      paymentMethod: 'MANUAL_EFT',
      creditedLedgerEntryId: null,
    }],
    promoAwards: [{
      id: 'award-1',
      status: 'AWARDED',
      awardType: 'MOBILE_VERIFIED',
      creditsAwarded: 3,
    }],
    leadUnlocks: [
      { id: 'unlock-1', creditsCharged: 1 },
      { id: 'unlock-2', creditsCharged: 1 },
    ],
    ...overrides,
  }
}

describe('provider credit reconciliation report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.provider = provider()
    mockDb.provider.findUnique.mockImplementation(async () => state.provider)
  })

  it('returns ok when wallet, ledger, payments, awards, and unlocks reconcile', async () => {
    const report = await buildProviderCreditReconciliationReport('provider-1')

    expect(report.ok).toBe(true)
    expect(report.replayedBalance).toEqual({
      paidCreditBalance: 4,
      promoCreditBalance: 2,
    })
    expect(report.counts).toMatchObject({
      ledgerEntries: 4,
      creditedPaymentIntents: 1,
      promoAwards: 1,
      leadUnlocks: 2,
      issues: 0,
    })
  })

  it('detects stored wallet balance drift from ledger replay', async () => {
    state.provider = provider({
      wallet: {
        id: 'wallet-1',
        providerId: 'provider-1',
        paidCreditBalance: 99,
        promoCreditBalance: 2,
        status: 'ACTIVE',
      },
    })

    const report = await buildProviderCreditReconciliationReport('provider-1')

    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'WALLET_BALANCE_MISMATCH',
      referenceId: 'wallet-1',
    }))
  })

  it('detects credited top-ups, promo awards, and lead unlocks missing ledger rows', async () => {
    state.provider = provider({
      wallet: {
        id: 'wallet-1',
        providerId: 'provider-1',
        paidCreditBalance: 0,
        promoCreditBalance: 0,
        status: 'ACTIVE',
      },
      walletLedgerEntries: [],
    })

    const report = await buildProviderCreditReconciliationReport('provider-1')

    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'CREDITED_PAYMENT_WITHOUT_LEDGER',
      'PROMO_AWARD_WITHOUT_LEDGER',
      'LEAD_UNLOCK_WITHOUT_DEBIT',
    ]))
  })

  it('detects test ledger entries that would leak into live reporting', async () => {
    state.provider = provider({
      isTestUser: true,
      cohortName: 'internal_staff_test',
      walletLedgerEntries: [
        ledgerEntry({
          id: 'ledger-test-unflagged',
          entryType: 'PROMO_CREDIT',
          creditType: 'PROMO',
          amountCredits: 3,
          isTestTransaction: false,
          cohortName: null,
          balanceAfterPaidCredits: 0,
          balanceAfterPromoCredits: 3,
          referenceType: 'provider_promo_award',
          referenceId: 'award-1',
        }),
      ],
      wallet: {
        id: 'wallet-1',
        providerId: 'provider-1',
        paidCreditBalance: 0,
        promoCreditBalance: 3,
        status: 'ACTIVE',
      },
      paymentIntents: [],
      leadUnlocks: [],
    })

    const report = await buildProviderCreditReconciliationReport('provider-1')

    expect(report.ok).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'TEST_LEDGER_FLAG_MISMATCH',
      referenceId: 'ledger-test-unflagged',
    }))
  })

  it('does not flag TEST_LEDGER_FLAG_MISMATCH when a non-test provider unlocks a test lead', async () => {
    // A live provider (isTestUser=false) may unlock a test lead during QA runs.
    // The resulting ledger entry has isTestTransaction=true and referenceType
    // 'test_lead_unlock'. This is expected behaviour — not a mismatch.
    state.provider = provider({
      isTestUser: false,
      walletLedgerEntries: [
        ledgerEntry({
          id: 'ledger-test-lead-unlock',
          entryType: 'LEAD_UNLOCK_DEBIT',
          creditType: 'PROMO',
          amountCredits: 1,
          isTestTransaction: true,
          cohortName: 'qa_cohort',
          balanceAfterPaidCredits: 0,
          balanceAfterPromoCredits: 2,
          referenceType: 'test_lead_unlock',
          referenceId: 'unlock-qa-1',
        }),
      ],
      wallet: {
        id: 'wallet-1',
        providerId: 'provider-1',
        paidCreditBalance: 0,
        promoCreditBalance: 2,
        status: 'ACTIVE',
      },
      paymentIntents: [],
      promoAwards: [],
      leadUnlocks: [{ id: 'unlock-qa-1', creditsCharged: 1 }],
    })

    const report = await buildProviderCreditReconciliationReport('provider-1')

    const mismatchIssues = report.issues.filter((issue) => issue.code === 'TEST_LEDGER_FLAG_MISMATCH')
    expect(mismatchIssues).toHaveLength(0)
  })

  it('returns a structured issue when provider does not exist', async () => {
    mockDb.provider.findUnique.mockResolvedValue(null)

    const report = await buildProviderCreditReconciliationReport('missing-provider')

    expect(report.ok).toBe(false)
    expect(report.issues).toEqual([expect.objectContaining({
      code: 'PROVIDER_NOT_FOUND',
      referenceId: 'missing-provider',
    })])
  })
})
