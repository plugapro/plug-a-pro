import { describe, expect, it } from 'vitest'
import type { WalletLedgerEntry } from '@prisma/client'
import {
  summarizeWalletLedgerEntry,
  walletLedgerSignedAmount,
} from '../../lib/wallet-ledger-display'

function walletLedgerEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ledger-1',
    walletId: 'wallet-1',
    providerId: 'provider-1',
    entryType: 'TOPUP_CREDIT',
    creditType: 'PAID',
    amountCredits: 10,
    isTestTransaction: false,
    cohortName: null,
    balanceAfterPaidCredits: 10,
    balanceAfterPromoCredits: 0,
    referenceType: 'payment_intent',
    referenceId: 'intent-1',
    description: null,
    idempotencyKey: null,
    traceId: null,
    source: null,
    metadata: {},
    createdBy: 'admin-1',
    createdAt: new Date(),
    ...overrides,
  } as WalletLedgerEntry
}

describe('summarizeWalletLedgerEntry', () => {
  it('builds a payment intent summary with payment reference and bank details', () => {
    const entry = walletLedgerEntry({
      metadata: {
        paymentReference: 'PAY-TEST-42',
        amountCents: 12345,
        bankStatementReference: 'BANK-001',
        source: 'manual eft',
      },
      source: 'recon',
    })

    const summary = summarizeWalletLedgerEntry(entry)

    expect(summary.title).toBe('Top-up from payment PAY-TEST-42')
    expect(summary.referenceTypeLabel).toBe('payment intent')
    expect(summary.details[0]).toMatch(/Amount R/) // currency format can vary by locale variant
    expect(summary.details).toContain('Bank reference BANK-001')
    expect(summary.details).toContain('Source recon')
    expect(summary.details).toContain('by admin-1')
    expect(summary.paymentIntentHref).toBe('/admin/provider-credit-payments/intent-1')
  })

  it('builds a lead-unlock summary from lead metadata', () => {
    const entry = walletLedgerEntry({
      entryType: 'LEAD_UNLOCK_DEBIT',
      referenceType: 'lead_unlock',
      referenceId: 'leadunlock-1',
      creditType: 'PAID',
      amountCredits: 3,
      metadata: {
        leadRef: 'LEAD-1234',
        jobTitle: 'Clean gutter',
        jobCategory: 'Plumbing',
      },
    })

    const summary = summarizeWalletLedgerEntry(entry)

    expect(summary.title).toBe('Lead unlock deduction for LEAD-1234')
    expect(summary.details).toContain('Clean gutter')
    expect(summary.details).toContain('Plumbing')
    expect(summary.details).toContain('by admin-1')
  })

  it('builds an admin adjustment summary from reason metadata', () => {
    const entry = walletLedgerEntry({
      entryType: 'ADMIN_ADJUSTMENT',
      creditType: 'PAID',
      amountCredits: 5,
      referenceType: 'admin_adjustment',
      metadata: {
        reason: 'Manual top-up correction',
      },
    })

    const summary = summarizeWalletLedgerEntry(entry)

    expect(summary.title).toBe('Manual admin adjustment')
    expect(summary.details).toContain('Reason: Manual top-up correction')
  })

  it('builds a voucher redemption summary with campaign metadata', () => {
    const entry = walletLedgerEntry({
      entryType: 'VOUCHER_REDEMPTION',
      referenceType: 'voucher',
      referenceId: 'voucher-abcdefgh',
      metadata: {
        campaignCode: 'PROMO2026',
        batchName: 'Q2 rollout',
      },
    })

    const summary = summarizeWalletLedgerEntry(entry)

    expect(summary.title).toBe('Voucher redemption')
    expect(summary.details).toContain('Campaign PROMO2026')
    expect(summary.details).toContain('Q2 rollout')
  })

  it('adds explicit actor from metadata helper fields', () => {
    const entry = walletLedgerEntry({
      entryType: 'ADMIN_ADJUSTMENT',
      referenceType: 'admin_adjustment',
      creditType: 'PAID',
      amountCredits: 2,
      metadata: {
        reason: 'Reconciled after duplicate top-up',
        adjustedBy: 'ops-007',
      },
    })

    const summary = summarizeWalletLedgerEntry(entry)

    expect(summary.details).toContain('Reason: Reconciled after duplicate top-up')
    expect(summary.details).toContain('by ops-007')
  })

  it('computes signed amount for debit-like entry types', () => {
    expect(walletLedgerSignedAmount({ entryType: 'LEAD_UNLOCK_DEBIT', amountCredits: 2 })).toBe(-2)
    expect(walletLedgerSignedAmount({ entryType: 'ADMIN_ADJUSTMENT', amountCredits: -1 })).toBe(-1)
    expect(walletLedgerSignedAmount({ entryType: 'TOPUP_CREDIT', amountCredits: 3 })).toBe(3)
  })

  it('summarizes a first-top-up KYC deduction as a fee settlement, not a top-up', () => {
    const entry = walletLedgerEntry({
      entryType: 'FIRST_TOPUP_KYC_DEDUCTION',
      creditType: 'PAID',
      amountCredits: 1,
      referenceType: 'payment_intent',
      referenceId: 'intent-1',
      description: 'Once-off ID verification fee (R50) settled from first top-up',
    })

    const summary = summarizeWalletLedgerEntry(entry)

    expect(summary.title).toContain('ID verification fee')
    expect(summary.title).not.toContain('Top-up from payment')
  })

  it('treats the first-top-up KYC deduction as a debit', () => {
    expect(
      walletLedgerSignedAmount({ entryType: 'FIRST_TOPUP_KYC_DEDUCTION', amountCredits: 1 }),
    ).toBe(-1)
  })
})
