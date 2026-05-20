/**
 * Step 09 — Provider Credit Balance and Ledger Flow
 *
 * Verifies:
 * 1. WhatsApp credits/balance/credit-history commands route to pj_credits
 * 2. buildProviderCreditSummaryMessage produces the blueprint-specified format
 *    (Available / Starter/onboarding / Purchased breakdown)
 * 3. Ledger entries contain all required fields (schema columns + metadata)
 * 4. No-deduction rules: free-action command aliases do not carry the
 *    debitCreditsForLeadUnlock signature
 * 5. Negative balance prevention — INSUFFICIENT_FUNDS guard and
 *    optimistic-concurrency guard both prevent balance going below zero
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

// ─── 1. WhatsApp command routing ─────────────────────────────────────────────

import {
  PROVIDER_WHATSAPP_COMMANDS,
  resolveProviderWhatsappCommand,
} from '../../lib/provider-whatsapp-command-model'

describe('credits command routing (step 09)', () => {
  it('credits command routes to pj_credits with provider_check_status replyId', () => {
    const cmd = resolveProviderWhatsappCommand('credits')
    expect(cmd?.step).toBe('pj_credits')
    expect(cmd?.replyId).toBe('provider_check_status')
    expect(cmd?.flow).toBe('provider_journey')
  })

  it('balance command routes to pj_credits with provider_check_status replyId', () => {
    const cmd = resolveProviderWhatsappCommand('balance')
    expect(cmd?.step).toBe('pj_credits')
    expect(cmd?.replyId).toBe('provider_check_status')
  })

  it('credit history command routes to pj_credits', () => {
    const cmd = resolveProviderWhatsappCommand('credit history')
    expect(cmd?.step).toBe('pj_credits')
    expect(cmd?.replyId).toBe('provider_check_status')
  })

  it('credits history command (alias) routes to pj_credits', () => {
    const cmd = resolveProviderWhatsappCommand('credits history')
    expect(cmd?.step).toBe('pj_credits')
  })

  it('wallet command (alias) routes to pj_credits', () => {
    const cmd = resolveProviderWhatsappCommand('wallet')
    expect(cmd?.step).toBe('pj_credits')
  })

  it('wallet history command (alias) routes to pj_credits', () => {
    const cmd = resolveProviderWhatsappCommand('wallet history')
    expect(cmd?.step).toBe('pj_credits')
  })

  it('credits command is case-insensitive', () => {
    expect(resolveProviderWhatsappCommand('CREDITS')?.step).toBe('pj_credits')
    expect(resolveProviderWhatsappCommand('Balance')?.step).toBe('pj_credits')
    expect(resolveProviderWhatsappCommand('CREDIT HISTORY')?.step).toBe('pj_credits')
  })

  it('credits command aliases are a subset of the credits command entry', () => {
    const creditsCmd = PROVIDER_WHATSAPP_COMMANDS.find((c) => c.command === 'credits')
    expect(creditsCmd).toBeDefined()
    expect(creditsCmd?.aliases).toContain('credits')
    expect(creditsCmd?.aliases).toContain('balance')
    expect(creditsCmd?.aliases).toContain('credit history')
    expect(creditsCmd?.aliases).toContain('wallet')
  })
})

// ─── 2. Credit summary message format ────────────────────────────────────────

import { buildProviderCreditSummaryMessage } from '../../lib/provider-credit-copy'

describe('buildProviderCreditSummaryMessage — blueprint format (step 09)', () => {
  it('includes the exact blueprint header "Your credits"', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 5,
      promoCreditBalance: 3,
      paidCreditBalance: 2,
    })
    expect(msg).toContain('Your credits')
  })

  it('shows Available, Starter/onboarding, and Purchased lines', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 7,
      promoCreditBalance: 4,
      paidCreditBalance: 3,
    })
    expect(msg).toContain('Available: 7')
    expect(msg).toContain('Starter/onboarding: 4')
    expect(msg).toContain('Purchased: 3')
  })

  it('shows the blueprint-required no-deduction rule line', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 1,
      promoCreditBalance: 1,
      paidCreditBalance: 0,
    })
    expect(msg).toContain('Credits are used only when you accept a customer-selected job')
  })

  it('does not expose a raw URL in the credits summary message', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 3,
      promoCreditBalance: 2,
      paidCreditBalance: 1,
    })
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('handles zero starter credits without showing negative numbers', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 5,
      promoCreditBalance: 0,
      paidCreditBalance: 5,
    })
    expect(msg).toContain('Available: 5')
    expect(msg).toContain('Starter/onboarding: 0')
    expect(msg).toContain('Purchased: 5')
    expect(msg).not.toMatch(/-\d/)
  })

  it('handles zero purchased credits without showing negative numbers', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 3,
      promoCreditBalance: 3,
      paidCreditBalance: 0,
    })
    expect(msg).toContain('Available: 3')
    expect(msg).toContain('Starter/onboarding: 3')
    expect(msg).toContain('Purchased: 0')
    expect(msg).not.toMatch(/-\d/)
  })

  it('handles a zero overall balance without showing negative numbers', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 0,
      promoCreditBalance: 0,
      paidCreditBalance: 0,
    })
    expect(msg).toContain('Available: 0')
    expect(msg).toContain('Starter/onboarding: 0')
    expect(msg).toContain('Purchased: 0')
    expect(msg).not.toMatch(/-\d/)
  })

  it('totalCreditBalance equals starter + purchased', () => {
    const starter = 7
    const purchased = 3
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: starter + purchased,
      promoCreditBalance: starter,
      paidCreditBalance: purchased,
    })
    expect(msg).toContain(`Available: ${starter + purchased}`)
    expect(msg).toContain(`Starter/onboarding: ${starter}`)
    expect(msg).toContain(`Purchased: ${purchased}`)
  })

  it('defaults missing promoCreditBalance / paidCreditBalance to zero', () => {
    const msg = buildProviderCreditSummaryMessage({
      totalCreditBalance: 2,
    })
    expect(msg).toContain('Starter/onboarding: 0')
    expect(msg).toContain('Purchased: 0')
  })
})

// ─── 3. Ledger field completeness ────────────────────────────────────────────

const { mockDb: walletMockDb, walletState } = vi.hoisted(() => {
  const walletState: {
    wallet: any
    entries: any[]
  } = {
    wallet: null,
    entries: [],
  }

  const mockDb = {
    $transaction: vi.fn(),
    providerWallet: {
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
    },
    walletLedgerEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  }

  return { mockDb, walletState }
})

vi.mock('../../lib/db', () => ({
  db: walletMockDb,
}))

import {
  creditPaidCredits,
  creditPromoCredits,
  debitCreditsForLeadUnlock,
  ProviderWalletError,
} from '../../lib/provider-wallet'

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-step09',
    providerId: 'provider-step09',
    paidCreditBalance: 0,
    promoCreditBalance: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-05-07T08:00:00Z'),
    updatedAt: new Date('2026-05-07T08:00:00Z'),
    ...overrides,
  }
}

function ref(overrides: Record<string, unknown> = {}) {
  return {
    referenceType: 'test',
    referenceId: 'ref-step09',
    description: 'Step 09 ledger field test',
    metadata: { source: 'unit-test' },
    createdBy: 'provider-step09',
    ...overrides,
  }
}

describe('ledger entry field completeness (step 09)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    walletState.wallet = makeWallet()
    walletState.entries = []

    walletMockDb.$transaction.mockImplementation(async (callback: (tx: typeof walletMockDb) => unknown) =>
      callback(walletMockDb as any),
    )

    walletMockDb.providerWallet.upsert.mockImplementation(async () => walletState.wallet)

    walletMockDb.providerWallet.update.mockImplementation(async (args: any) => {
      const paidInc = args.data.paidCreditBalance?.increment ?? 0
      const promoInc = args.data.promoCreditBalance?.increment ?? 0
      walletState.wallet = {
        ...walletState.wallet,
        paidCreditBalance: walletState.wallet.paidCreditBalance + paidInc,
        promoCreditBalance: walletState.wallet.promoCreditBalance + promoInc,
      }
      return walletState.wallet
    })

    walletMockDb.providerWallet.updateMany.mockImplementation(async (args: any) => {
      const paidDec = args.data.paidCreditBalance?.decrement ?? 0
      const promoDec = args.data.promoCreditBalance?.decrement ?? 0
      const exactPaid = args.where.AND.find((c: any) => typeof c.paidCreditBalance === 'number')?.paidCreditBalance
      const exactPromo = args.where.AND.find((c: any) => typeof c.promoCreditBalance === 'number')?.promoCreditBalance

      if (
        walletState.wallet.paidCreditBalance !== exactPaid ||
        walletState.wallet.promoCreditBalance !== exactPromo ||
        walletState.wallet.paidCreditBalance < paidDec ||
        walletState.wallet.promoCreditBalance < promoDec
      ) {
        return { count: 0 }
      }

      walletState.wallet = {
        ...walletState.wallet,
        paidCreditBalance: walletState.wallet.paidCreditBalance - paidDec,
        promoCreditBalance: walletState.wallet.promoCreditBalance - promoDec,
      }
      return { count: 1 }
    })

    walletMockDb.providerWallet.findUniqueOrThrow.mockImplementation(async () => walletState.wallet)
    walletMockDb.providerWallet.findUnique.mockImplementation(async () => walletState.wallet)

    walletMockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `entry-s09-${walletState.entries.length + 1}`,
        createdAt: new Date('2026-05-07T09:00:00Z'),
        ...args.data,
      }
      walletState.entries.push(entry)
      return entry
    })

    walletMockDb.walletLedgerEntry.findMany.mockResolvedValue([])
  })

  it('paid top-up entry has required scalar fields: providerId, entryType, creditType, amountCredits, referenceType, referenceId, createdAt', async () => {
    const result = await creditPaidCredits('provider-step09', 3, ref())
    const entry = result.ledgerEntries[0]

    expect(entry).toMatchObject({
      providerId: 'provider-step09',
      entryType: 'TOPUP_CREDIT',
      creditType: 'PAID',
      amountCredits: 3,
      referenceType: 'test',
      referenceId: 'ref-step09',
    })
    expect(entry.createdAt).toBeInstanceOf(Date)
  })

  it('paid top-up entry metadata contains balanceBeforePaidCredits and balanceBeforePromoCredits (balance_before fields)', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 1 })

    const result = await creditPaidCredits('provider-step09', 5, ref())
    const entry = result.ledgerEntries[0]

    expect(entry.metadata).toMatchObject({
      balanceBeforePaidCredits: 2,
      balanceBeforePromoCredits: 1,
    })
  })

  it('paid top-up entry has explicit balanceAfterPaidCredits and balanceAfterPromoCredits columns (balance_after fields)', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 1, promoCreditBalance: 2 })

    const result = await creditPaidCredits('provider-step09', 4, ref())
    const entry = result.ledgerEntries[0]

    // starter_balance_after / purchased_balance_after as per blueprint
    expect(entry.balanceAfterPaidCredits).toBe(5)    // purchased_balance_after
    expect(entry.balanceAfterPromoCredits).toBe(2)   // starter_balance_after
  })

  it('promo credit entry uses PROMO creditType (starter bucket)', async () => {
    const result = await creditPromoCredits('provider-step09', 3, ref({
      referenceType: 'promo_campaign',
      referenceId: 'launch-s09',
    }))
    const entry = result.ledgerEntries[0]

    expect(entry.entryType).toBe('PROMO_CREDIT')
    expect(entry.creditType).toBe('PROMO')
    // starter_balance_after
    expect(entry.balanceAfterPromoCredits).toBe(3)
    // purchased_balance_after unchanged
    expect(entry.balanceAfterPaidCredits).toBe(0)
  })

  it('lead unlock debit entry metadata can carry traceId and idempotencyKey (trace_id / idempotency_key fields)', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 5, promoCreditBalance: 0 })

    const result = await debitCreditsForLeadUnlock('provider-step09', 1, ref({
      referenceType: 'lead_unlock',
      referenceId: 'unlock-s09',
      metadata: {
        leadId: 'lead-abc',
        jobRequestId: 'jobrequest-xyz',
        source: 'whatsapp',
        traceId: 'trace-abc123',
        idempotencyKey: 'idem-key-001',
      },
    }))

    const entry = result.ledgerEntries[0]
    expect(entry.entryType).toBe('LEAD_UNLOCK_DEBIT')
    expect(entry.metadata).toMatchObject({
      leadId: 'lead-abc',
      jobRequestId: 'jobrequest-xyz',
      source: 'whatsapp',
      traceId: 'trace-abc123',
      idempotencyKey: 'idem-key-001',
    })
  })

  it('lead unlock debit entry metadata also stores balance_before fields', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 3, promoCreditBalance: 2 })

    const result = await debitCreditsForLeadUnlock('provider-step09', 1, ref({
      referenceType: 'lead_unlock',
      referenceId: 'unlock-before-s09',
    }))

    // Promo credits consumed first
    const promoEntry = result.ledgerEntries[0]
    expect(promoEntry.metadata).toMatchObject({
      balanceBeforePaidCredits: 3,
      balanceBeforePromoCredits: 2,
    })
  })
})

// ─── 4. No-deduction rule: free actions must not carry debit signature ────────

describe('no-deduction rules (step 09)', () => {
  it('preview/interest command aliases do not include debitCreditsForLeadUnlock in their step', () => {
    // The blueprint mandates: preview, interest response, shortlist, customer
    // selection, decline, and expiry must NOT deduct credits.
    //
    // This test verifies at the command-model level: the free-action aliases
    // all resolve to steps OTHER than the lead-unlock debit path.
    // The debit path is wired exclusively via the 'accept_job' command which
    // must only trigger after customer selection + provider confirmation.

    const freeActionAliases = [
      // Preview / opportunity review
      'opportunities', 'available jobs', 'find work', 'leads',
      // Interest response
      'interested', 'not interested', 'pass',
      // Decline
      'decline', 'decline job',
    ]

    for (const alias of freeActionAliases) {
      const cmd = resolveProviderWhatsappCommand(alias)
      // Must not route to the job list (which triggers debit on accept_job confirm)
      // These must all stay in the preview/opportunity/decline path
      expect(cmd?.step, `"${alias}" should not be the job-list step`).not.toBe('pj_job_list')
    }
  })

  it('credits command routes to focused credits display, not to the lead unlock debit path', () => {
    const cmd = resolveProviderWhatsappCommand('credits')
    expect(cmd?.step).toBe('pj_credits')
    // pj_credits is a focused display step; it has no debit path
    expect(cmd?.step).not.toBe('pj_job_list')
    expect(cmd?.step).not.toBe('pj_available_leads')
  })
})

// ─── 5. Negative balance prevention ──────────────────────────────────────────

describe('negative balance prevention (step 09)', () => {
  // These tests use the same mock setup created in the describe block above.
  // vi.mock is hoisted so the mock is shared across all describe blocks in this file.

  beforeEach(() => {
    vi.clearAllMocks()
    walletState.wallet = makeWallet()
    walletState.entries = []

    walletMockDb.$transaction.mockImplementation(async (callback: (tx: typeof walletMockDb) => unknown) =>
      callback(walletMockDb as any),
    )

    walletMockDb.providerWallet.upsert.mockImplementation(async () => walletState.wallet)

    walletMockDb.providerWallet.update.mockImplementation(async (args: any) => {
      const paidInc = args.data.paidCreditBalance?.increment ?? 0
      const promoInc = args.data.promoCreditBalance?.increment ?? 0
      walletState.wallet = {
        ...walletState.wallet,
        paidCreditBalance: walletState.wallet.paidCreditBalance + paidInc,
        promoCreditBalance: walletState.wallet.promoCreditBalance + promoInc,
      }
      return walletState.wallet
    })

    walletMockDb.providerWallet.updateMany.mockImplementation(async (args: any) => {
      const paidDec = args.data.paidCreditBalance?.decrement ?? 0
      const promoDec = args.data.promoCreditBalance?.decrement ?? 0
      const exactPaid = args.where.AND.find((c: any) => typeof c.paidCreditBalance === 'number')?.paidCreditBalance
      const exactPromo = args.where.AND.find((c: any) => typeof c.promoCreditBalance === 'number')?.promoCreditBalance

      if (
        walletState.wallet.paidCreditBalance !== exactPaid ||
        walletState.wallet.promoCreditBalance !== exactPromo ||
        walletState.wallet.paidCreditBalance < paidDec ||
        walletState.wallet.promoCreditBalance < promoDec
      ) {
        return { count: 0 }
      }

      walletState.wallet = {
        ...walletState.wallet,
        paidCreditBalance: walletState.wallet.paidCreditBalance - paidDec,
        promoCreditBalance: walletState.wallet.promoCreditBalance - promoDec,
      }
      return { count: 1 }
    })

    walletMockDb.providerWallet.findUniqueOrThrow.mockImplementation(async () => walletState.wallet)
    walletMockDb.providerWallet.findUnique.mockImplementation(async () => walletState.wallet)

    walletMockDb.walletLedgerEntry.create.mockImplementation(async (args: any) => {
      const entry = {
        id: `entry-neg-${walletState.entries.length + 1}`,
        createdAt: new Date(),
        ...args.data,
      }
      walletState.entries.push(entry)
      return entry
    })

    walletMockDb.walletLedgerEntry.findMany.mockResolvedValue([])
  })

  it('throws INSUFFICIENT_FUNDS when total balance is zero and a debit is attempted', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 0 })

    await expect(
      debitCreditsForLeadUnlock('provider-step09', 1, ref({
        referenceType: 'lead_unlock',
        referenceId: 'unlock-zero',
      })),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    } satisfies Partial<ProviderWalletError>)
  })

  it('throws INSUFFICIENT_FUNDS when debit exceeds combined starter + purchased balance', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 1, promoCreditBalance: 1 })

    await expect(
      debitCreditsForLeadUnlock('provider-step09', 3, ref({
        referenceType: 'lead_unlock',
        referenceId: 'unlock-over',
      })),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    } satisfies Partial<ProviderWalletError>)
  })

  it('does not write a ledger entry when INSUFFICIENT_FUNDS is thrown', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 0 })

    await debitCreditsForLeadUnlock('provider-step09', 1, ref({
      referenceType: 'lead_unlock',
      referenceId: 'unlock-no-entry',
    })).catch(() => {})

    expect(walletMockDb.walletLedgerEntry.create).not.toHaveBeenCalled()
    expect(walletState.entries).toHaveLength(0)
  })

  it('does not update the wallet row when INSUFFICIENT_FUNDS is thrown', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 0, promoCreditBalance: 0 })

    await debitCreditsForLeadUnlock('provider-step09', 1, ref({
      referenceType: 'lead_unlock',
      referenceId: 'unlock-no-update',
    })).catch(() => {})

    expect(walletMockDb.providerWallet.updateMany).not.toHaveBeenCalled()
  })

  it('optimistic concurrency guard throws CONCURRENT_MUTATION when wallet changed between read and write', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 5, promoCreditBalance: 0 })

    // Force updateMany to return count 0 (simulating concurrent mutation)
    walletMockDb.providerWallet.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      debitCreditsForLeadUnlock('provider-step09', 1, ref({
        referenceType: 'lead_unlock',
        referenceId: 'unlock-concurrent',
      })),
    ).rejects.toMatchObject({
      code: 'CONCURRENT_MUTATION',
    } satisfies Partial<ProviderWalletError>)
  })

  it('successful debit of exactly 1 credit from starter balance leaves non-negative balances', async () => {
    walletState.wallet = makeWallet({ paidCreditBalance: 2, promoCreditBalance: 1 })

    const result = await debitCreditsForLeadUnlock('provider-step09', 1, ref({
      referenceType: 'lead_unlock',
      referenceId: 'unlock-exact',
    }))

    // Promo consumed first: 1 from promo, 0 from paid
    expect(result.wallet.paidCreditBalance).toBeGreaterThanOrEqual(0)
    expect(result.wallet.promoCreditBalance).toBeGreaterThanOrEqual(0)
    expect(result.wallet.paidCreditBalance + result.wallet.promoCreditBalance).toBe(2)
  })
})
