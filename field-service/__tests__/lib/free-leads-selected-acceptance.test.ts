// Free leads mode (provider.leads.free) - Path B (customer-selected acceptance)
// end-to-end through the REAL credit check, credit application and accepted
// lock, against a small stateful transaction mock.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'
import { applyProviderCreditForAcceptedLeadInTransaction } from '../../lib/provider-credit-application'
import { checkProviderLeadCreditBalanceInTransaction } from '../../lib/provider-credit-check'
import { lockAcceptedLeadAfterCreditInTransaction } from '../../lib/provider-accepted-lock'

const { mockDb, state, mockIsFreeLeadsEnabled, mockAssertIdentity, MockIdentityCreditGateError } = vi.hoisted(() => {
  class MockIdentityCreditGateError extends Error {
    readonly code = 'IDENTITY_NOT_VERIFIED'
    constructor() {
      super('High-assurance identity verification is required.')
      this.name = 'IdentityCreditGateError'
    }
  }
  const state: {
    lead: any
    unlock: any
    wallet: any
    ledgerEntries: any[]
    audits: any[]
    leadStatusWrites: string[]
  } = {
    lead: null,
    unlock: null,
    wallet: null,
    ledgerEntries: [],
    audits: [],
    leadStatusWrites: [],
  }
  return {
    mockDb: { $transaction: vi.fn() },
    state,
    mockIsFreeLeadsEnabled: vi.fn(),
    mockAssertIdentity: vi.fn(),
    MockIdentityCreditGateError,
  }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/free-leads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/free-leads')>()),
  isFreeLeadsEnabled: mockIsFreeLeadsEnabled,
}))
vi.mock('../../lib/identity-verification/credit-gate', () => ({
  IdentityCreditGateError: MockIdentityCreditGateError,
  assertIdentityVerifiedForCredits: mockAssertIdentity,
}))
vi.mock('../../lib/post-lock-fulfilment', () => ({
  materializeFulfilmentArtifacts: vi.fn().mockResolvedValue({ matchId: 'match-1', quoteId: 'quote-1' }),
}))
vi.mock('../../lib/workflow-events/record', () => ({
  recordWorkflowEvent: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('../../lib/provider-accepted-lock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/provider-accepted-lock')>()),
  notifyAcceptedLeadLocked: vi.fn().mockResolvedValue(true),
  notifyNonSelectedRfpProviders: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/whatsapp', () => ({
  sendText: vi.fn().mockResolvedValue('wamid-text'),
  sendTemplate: vi.fn().mockResolvedValue('wamid-template'),
}))
vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyLeadUnlocked: vi.fn().mockResolvedValue(undefined),
}))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    jobRequestId: 'request-1',
    providerId: 'provider-1',
    status: 'CUSTOMER_SELECTED',
    expiresAt: new Date(Date.now() + 60 * 60_000),
    cancelledAt: null,
    customerSelectedAt: new Date('2026-10-01T10:00:00.000Z'),
    providerAcceptedAt: null,
    provider: { id: 'provider-1', name: 'Test Provider', phone: '+27000000001', isTestUser: false, active: true, verified: true, status: 'ACTIVE' },
    providerResponses: [],
    jobRequest: {
      id: 'request-1',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      expiresAt: null,
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
      isTestRequest: false,
      cohortName: null,
      category: 'plumbing',
      description: 'Leaking tap',
      requestedWindowStart: null,
      requestedWindowEnd: null,
      customer: { name: 'Test Customer', phone: '+27000000002' },
      address: null,
      attachments: [],
      match: null,
    },
    ...overrides,
  }
}

function setLeadStatus(status: string) {
  state.leadStatusWrites.push(status)
  state.lead = { ...state.lead, status }
}

function statusMatches(where: any) {
  if (!where?.status) return true
  if (typeof where.status === 'string') return where.status === state.lead.status
  if (Array.isArray(where.status.in)) return where.status.in.includes(state.lead.status)
  return true
}

const tx = {
  lead: {
    findUnique: vi.fn(async () => (state.lead ? { ...state.lead, unlock: state.unlock } : null)),
    update: vi.fn(async (args: any) => {
      if (args.data?.status) setLeadStatus(args.data.status)
      return state.lead
    }),
    updateMany: vi.fn(async (args: any) => {
      if (args.where?.id && args.where.id !== state.lead.id) {
        // sibling-lead sweeps in the accepted lock
        return { count: 0 }
      }
      if (args.where?.id?.not) return { count: 0 }
      if (!statusMatches(args.where)) return { count: 0 }
      if (args.data?.status) setLeadStatus(args.data.status)
      return { count: 1 }
    }),
  },
  providerWallet: {
    findUnique: vi.fn(async () => state.wallet),
    updateMany: vi.fn(async () => {
      throw new Error('wallet must not be debited in free leads mode')
    }),
  },
  walletLedgerEntry: {
    findMany: vi.fn(async () => state.ledgerEntries),
    findFirst: vi.fn(async () => state.ledgerEntries.at(-1) ?? null),
    create: vi.fn(async () => {
      throw new Error('ledger must not be written in free leads mode')
    }),
  },
  leadUnlock: {
    create: vi.fn(async (args: any) => {
      state.unlock = { id: 'unlock-1', unlockedAt: new Date(), ...args.data }
      return state.unlock
    }),
    update: vi.fn(async (args: any) => {
      state.unlock = { ...state.unlock, ...args.data }
      return state.unlock
    }),
  },
  jobRequest: {
    updateMany: vi.fn(async (args: any) => {
      if (args.where.status && args.where.status !== state.lead.jobRequest.status) return { count: 0 }
      state.lead = { ...state.lead, jobRequest: { ...state.lead.jobRequest, status: args.data.status } }
      return { count: 1 }
    }),
  },
  auditLog: {
    create: vi.fn(async (args: any) => {
      state.audits.push(args.data)
      return { id: `audit-${state.audits.length}` }
    }),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  state.lead = makeLead()
  state.unlock = null
  state.wallet = null
  state.ledgerEntries = []
  state.audits = []
  state.leadStatusWrites = []
  mockIsFreeLeadsEnabled.mockResolvedValue(true)
  mockAssertIdentity.mockResolvedValue(undefined)
  mockDb.$transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx))
})

describe('free leads mode - customer-selected acceptance (Path B)', () => {
  it('flag ON with no wallet: accepts and locks, writes a zero-charge unlock, never sets CREDIT_REQUIRED', async () => {
    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1', source: 'whatsapp' })

    expect(result).toMatchObject({
      ok: true,
      creditApplied: true,
      creditTransactionId: null,
      acceptedLock: { leadStatus: 'ACCEPTED_LOCKED', serviceRequestStatus: 'ACCEPTED_LOCKED', creditTransactionId: null },
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.creditCheck).toMatchObject({ ok: true, requiredCredits: 0 })
    expect(state.unlock).toMatchObject({ creditsCharged: 0, creditTypeBreakdown: { free: true }, status: 'UNLOCKED' })
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')
    expect(state.leadStatusWrites).not.toContain('CREDIT_REQUIRED')
    expect(state.leadStatusWrites).toEqual(['PROVIDER_ACCEPTED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED'])
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled()
    expect(tx.providerWallet.updateMany).not.toHaveBeenCalled()

    const applied = state.audits.find((audit) => audit.action === 'lead.provider_credit_applied')
    expect(applied?.after).toMatchObject({ status: 'CREDIT_APPLIED', free: true, requiredCredits: 0, creditTransactionId: null })
    expect(mockAssertIdentity).toHaveBeenCalledWith('provider-1', tx)
    expect(mockIsFreeLeadsEnabled).toHaveBeenCalledTimes(1)
  })

  it('flag ON: an inactive wallet with a zero balance does not block', async () => {
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'SUSPENDED' }

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result.ok).toBe(true)
    expect(state.unlock).toMatchObject({ creditsCharged: 0 })
  })

  it('flag ON: the identity gate is still enforced', async () => {
    mockAssertIdentity.mockRejectedValue(new MockIdentityCreditGateError())

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toEqual({ ok: false, reason: 'IDENTITY_NOT_VERIFIED' })
    expect(state.unlock).toBeNull()
    expect(state.lead.status).toBe('CUSTOMER_SELECTED')
  })

  it('flag ON: a repeat accept after the lock is idempotent without a wallet', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')

    const again = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(again).toMatchObject({ ok: true, alreadyAccepted: true, alreadyUnlocked: true, creditTransactionId: null })
    expect(tx.leadUnlock.create).toHaveBeenCalledTimes(1)
  })

  it('flag OFF: no wallet is still blocked by the pre-gate (unchanged)', async () => {
    mockIsFreeLeadsEnabled.mockResolvedValue(false)

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({ ok: false, reason: 'INSUFFICIENT_CREDITS' })
    expect(state.unlock).toBeNull()
    expect(state.lead.status).toBe('CUSTOMER_SELECTED')
  })
})

describe('free leads mode - credit check', () => {
  it('flag ON: passes without a wallet and moves CREDIT_REQUIRED back to PROVIDER_ACCEPTED', async () => {
    state.lead = makeLead({ status: 'CREDIT_REQUIRED' })

    const result = await checkProviderLeadCreditBalanceInTransaction(tx as any, {
      leadId: 'lead-1',
      providerId: 'provider-1',
      freeLeads: true,
    })

    expect(result).toMatchObject({ ok: true, result: 'SUFFICIENT_CREDITS', requiredCredits: 0, currentCreditBalance: 0 })
    expect(result.providerMessage).toContain('Free during launch — no credits needed.')
    expect(state.lead.status).toBe('PROVIDER_ACCEPTED')
    expect(state.leadStatusWrites).not.toContain('CREDIT_REQUIRED')
  })

  it('flag OFF: no wallet still sets CREDIT_REQUIRED', async () => {
    state.lead = makeLead({ status: 'PROVIDER_ACCEPTED' })

    const result = await checkProviderLeadCreditBalanceInTransaction(tx as any, {
      leadId: 'lead-1',
      providerId: 'provider-1',
      freeLeads: false,
    })

    expect(result).toMatchObject({ ok: false, reason: 'WALLET_MISSING' })
    expect(state.lead.status).toBe('CREDIT_REQUIRED')
  })
})

describe('free leads mode - credit application idempotency', () => {
  it('replays a free unlock without a wallet even after the flag flips OFF', async () => {
    state.lead = makeLead({ status: 'CREDIT_APPLIED' })
    state.unlock = { id: 'unlock-1', leadId: 'lead-1', providerId: 'provider-1', creditsCharged: 0, creditTypeBreakdown: { free: true } }

    const result = await applyProviderCreditForAcceptedLeadInTransaction(tx as any, {
      leadId: 'lead-1',
      providerId: 'provider-1',
      freeLeads: false,
    })

    expect(result).toMatchObject({ ok: true, alreadyApplied: true, requiredCredits: 0, creditTransactionId: null, leadUnlockId: 'unlock-1' })
  })

  it('recovers a pre-existing paid debit as paid even when the flag is ON', async () => {
    state.lead = makeLead({ status: 'PROVIDER_ACCEPTED' })
    state.wallet = { id: 'wallet-1', paidCreditBalance: 1, promoCreditBalance: 0, status: 'ACTIVE' }
    state.ledgerEntries = [{
      id: 'ledger-1',
      creditType: 'PAID',
      amountCredits: 1,
      balanceAfterPaidCredits: 1,
      balanceAfterPromoCredits: 0,
    }]

    const result = await applyProviderCreditForAcceptedLeadInTransaction(tx as any, {
      leadId: 'lead-1',
      providerId: 'provider-1',
      freeLeads: true,
    })

    expect(state.unlock).toMatchObject({ creditsCharged: 1 })
    expect(result).toMatchObject({ requiredCredits: 1, creditTransactionId: 'ledger-1' })
  })
})

describe('free leads mode - accepted lock', () => {
  it('locks a lead whose persisted unlock is free (creditsCharged 0) without a debit row, regardless of the live flag', async () => {
    mockIsFreeLeadsEnabled.mockResolvedValue(false)
    state.lead = makeLead({ status: 'CREDIT_APPLIED' })
    state.unlock = { id: 'unlock-1', leadId: 'lead-1', providerId: 'provider-1', creditsCharged: 0, creditTypeBreakdown: { free: true } }

    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, { leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({ ok: true, leadStatus: 'ACCEPTED_LOCKED', creditTransactionId: null, alreadyLocked: false })
    const lockAudit = state.audits.find((audit) => audit.action === 'lead.provider_accepted_locked')
    expect(lockAudit?.after).toMatchObject({ free: true, creditTransactionId: null })
  })

  it('still rejects a paid unlock (creditsCharged 1) that is missing its debit row', async () => {
    mockIsFreeLeadsEnabled.mockResolvedValue(true)
    state.lead = makeLead({ status: 'CREDIT_APPLIED' })
    state.unlock = { id: 'unlock-1', leadId: 'lead-1', providerId: 'provider-1', creditsCharged: 1, creditTypeBreakdown: { paid: 1 } }

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, { leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'CREDIT_TRANSACTION_MISSING' })
    expect(state.lead.status).toBe('CREDIT_APPLIED')
  })

  it('still rejects an already-locked paid unlock missing its debit row', async () => {
    state.lead = makeLead({
      status: 'ACCEPTED_LOCKED',
      jobRequest: { ...makeLead().jobRequest, status: 'ACCEPTED_LOCKED' },
    })
    state.unlock = { id: 'unlock-1', leadId: 'lead-1', providerId: 'provider-1', creditsCharged: 1, creditTypeBreakdown: { paid: 1 } }

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, { leadId: 'lead-1', providerId: 'provider-1' }),
    ).rejects.toMatchObject({ code: 'CREDIT_TRANSACTION_MISSING' })
  })

  it('treats an already-locked free unlock as idempotent', async () => {
    state.lead = makeLead({
      status: 'ACCEPTED_LOCKED',
      jobRequest: { ...makeLead().jobRequest, status: 'ACCEPTED_LOCKED' },
    })
    state.unlock = { id: 'unlock-1', leadId: 'lead-1', providerId: 'provider-1', creditsCharged: 0, creditTypeBreakdown: { free: true } }

    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, { leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({ ok: true, alreadyLocked: true, creditTransactionId: null })
  })
})
