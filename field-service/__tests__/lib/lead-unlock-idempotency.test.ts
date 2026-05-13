// Tests that unlockLeadForProvider never deducts more than 1 credit even if called
// twice (duplicate WhatsApp webhook, double-tap). The guard relies on
// LeadUnlock.leadId @unique: the first call creates the row, the second call finds
// it and returns alreadyUnlocked: true without entering the transaction.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLeadUnlock,
  mockLead,
  mockProviderWallet,
  mockTransaction,
  mockDebitCredits,
} = vi.hoisted(() => {
  const txMock = {
    lead: { findUnique: vi.fn(), update: vi.fn() },
    leadUnlock: { create: vi.fn(), update: vi.fn() },
    providerWallet: { findUnique: vi.fn() },
    jobRequest: { update: vi.fn() },
    match: { create: vi.fn() },
  }
  return {
    mockLeadUnlock: { findUnique: vi.fn() },
    mockLead: { findUnique: vi.fn() },
    mockProviderWallet: { findUnique: vi.fn() },
    mockTransaction: { mock: txMock, fn: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)) },
    mockDebitCredits: vi.fn(),
  }
})

vi.mock('@/lib/db', () => ({
  db: {
    leadUnlock: mockLeadUnlock,
    $transaction: mockTransaction.fn,
  },
}))

vi.mock('@/lib/provider-wallet-notifications', () => ({
  notifyLeadUnlocked: vi.fn().mockResolvedValue(undefined),
  notifyProviderLowBalance: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/provider-wallet', () => ({
  debitCreditsForLeadUnlockInTransaction: mockDebitCredits,
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5000,
  ProviderWalletError: class ProviderWalletError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
}))

const EXISTING_UNLOCK = {
  id: 'u-1',
  leadId: 'lead-1',
  providerId: 'prov-1',
  creditsCharged: 1,
  status: 'UNLOCKED',
  creditTypeBreakdown: {},
  createdAt: new Date(),
  updatedAt: new Date(),
}

const VALID_LEAD = {
  id: 'lead-1',
  providerId: 'prov-1',
  jobRequestId: 'jr-1',
  status: 'SENT',
  expiresAt: new Date(Date.now() + 3600_000),
  provider: { id: 'prov-1', active: true, verified: true, status: 'ACTIVE', isTestUser: false },
  jobRequest: {
    id: 'jr-1',
    status: 'OPEN',
    isTestRequest: false,
    cohortName: null,
    match: null,
  },
}

describe('unlockLeadForProvider — idempotency (duplicate webhook / double-tap)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mock.lead.findUnique.mockResolvedValue(VALID_LEAD)
    mockTransaction.mock.providerWallet.findUnique.mockResolvedValue({
      paidCreditBalance: 3,
      promoCreditBalance: 0,
    })
    mockDebitCredits.mockResolvedValue({
      ledgerEntries: [{ creditType: 'PAID', amountCredits: -1 }],
      wallet: { paidCreditBalance: 2, promoCreditBalance: 0 },
    })
    mockTransaction.mock.leadUnlock.create.mockResolvedValue({
      id: 'u-1',
      leadId: 'lead-1',
      providerId: 'prov-1',
      creditTypeBreakdown: {},
    })
    mockTransaction.mock.leadUnlock.update.mockResolvedValue({ id: 'u-1', creditTypeBreakdown: { paid: -1 } })
  })

  it('called twice for the same lead: credits deducted exactly once, second call returns alreadyUnlocked=true', async () => {
    // First call: no existing unlock
    mockLeadUnlock.findUnique.mockResolvedValueOnce(null)
    // Second call: existing unlock found
    mockLeadUnlock.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      leadId: 'lead-1',
      providerId: 'prov-1',
      creditTypeBreakdown: {},
      creditsCharged: 1,
      status: 'UNLOCKED',
    })

    const { unlockLeadForProvider } = await import('@/lib/lead-unlocks')

    const result1 = await unlockLeadForProvider('lead-1', 'prov-1')
    const result2 = await unlockLeadForProvider('lead-1', 'prov-1')

    expect(result1.alreadyUnlocked).toBe(false)
    expect(result2.alreadyUnlocked).toBe(true)
    expect(result2.ledgerEntries).toEqual([])

    // Credit deduction must happen exactly once across both calls
    expect(mockDebitCredits).toHaveBeenCalledTimes(1)
    // Transaction only entered on first call
    expect(mockTransaction.fn).toHaveBeenCalledTimes(1)
  })

  it('throws FORBIDDEN if a second provider tries to unlock the same lead', async () => {
    mockLeadUnlock.findUnique.mockResolvedValue({
      id: 'u-1',
      leadId: 'lead-1',
      providerId: 'prov-1',
    })

    const { unlockLeadForProvider, LeadUnlockError } = await import('@/lib/lead-unlocks')

    await expect(unlockLeadForProvider('lead-1', 'prov-other')).rejects.toThrow(LeadUnlockError)
    expect(mockDebitCredits).not.toHaveBeenCalled()
  })
})
