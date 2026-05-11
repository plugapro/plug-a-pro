import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; lead: any; wallet: any } = { tx: null, lead: null, wallet: null }
  const mockDb = { $transaction: vi.fn() }
  return { mockDb, state }
})
const mockApplyProviderCredit = vi.hoisted(() => vi.fn())

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/lead-unlocks', () => {
  class LeadUnlockError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly currentCreditBalance?: number,
    ) {
      super(message)
      this.name = 'LeadUnlockError'
    }
  }

  return {
    LEAD_UNLOCK_COST_CREDITS: 1,
    LeadUnlockError,
    unlockLeadForProviderInTransaction: vi.fn().mockResolvedValue({
      unlock: { id: 'unlock-1' },
      ledgerEntries: [{ id: 'ledger-1', balanceAfterPaidCredits: 1, balanceAfterPromoCredits: 0 }],
      alreadyUnlocked: false,
    }),
  }
})
vi.mock('../../lib/provider-credit-application', () => ({
  ProviderCreditApplicationError: class ProviderCreditApplicationError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly currentCreditBalance?: number,
    ) {
      super(message)
      this.name = 'ProviderCreditApplicationError'
    }
  },
  applyProviderCreditForAcceptedLeadInTransaction: mockApplyProviderCredit,
}))
vi.mock('../../lib/provider-lead-access', () => ({
  getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/jobs/signed-token'),
}))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/request/signed-token'),
}))
vi.mock('../../lib/whatsapp', () => ({
  sendText: vi.fn().mockResolvedValue('wamid-text'),
}))
vi.mock('../../lib/whatsapp-interactive', () => ({
  sendCtaUrl: vi.fn().mockResolvedValue('wamid-cta'),
}))
vi.mock('../../lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn((key: string) => (key === 'job_detail' ? 'View job' : 'View details')),
}))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    jobRequestId: 'request-1',
    providerId: 'provider-1',
    status: 'CUSTOMER_SELECTED',
    expiresAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    customerSelectedAt: new Date('2026-05-02T10:00:00.000Z'),
    providerAcceptedAt: null,
    isTestLead: false,
    cohortName: null,
    unlock: null,
    provider: {
      id: 'provider-1',
      name: 'Alice Plumbing',
      phone: '+27111111111',
    },
    providerResponses: [
      {
        callOutFee: 250,
        estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
      },
    ],
    jobRequest: {
      id: 'request-1',
      category: 'plumbing',
      description: 'Burst pipe under the kitchen sink',
      requestedWindowStart: new Date('2026-05-02T12:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-02T14:00:00.000Z'),
      isTestRequest: false,
      cohortName: null,
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
      customer: { name: 'Thandi Customer', phone: '+27222222222' },
      attachments: [],
      address: {
        street: '1 Oak Avenue',
        addressLine1: null,
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Sunnyside',
        city: 'Pretoria',
        province: 'Gauteng',
        accessNotes: null,
      },
      match: null,
    },
    ...overrides,
  }
}

function makeTx() {
  return {
    lead: {
      findUnique: vi.fn().mockImplementation(async () => state.lead),
      update: vi.fn().mockImplementation(async (args: any) => {
        if (args?.data?.status) state.lead = { ...state.lead, status: args.data.status }
        return state.lead
      }),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (args?.where?.status === state.lead.status && args?.data?.status) {
          state.lead = { ...state.lead, status: args.data.status }
        } else if (args?.where?.status?.in?.includes(state.lead.status) && args?.data?.status) {
          state.lead = { ...state.lead, status: args.data.status }
        }
        return { count: 1 }
      }),
    },
    providerWallet: {
      findUnique: vi.fn().mockImplementation(async () => state.wallet),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    match: { create: vi.fn().mockResolvedValue({ id: 'match-1' }) },
    quote: { create: vi.fn().mockResolvedValue({ id: 'quote-1' }) },
    booking: { create: vi.fn().mockResolvedValue({ id: 'booking-1' }) },
    job: { create: vi.fn().mockResolvedValue({ id: 'job-1' }) },
    jobRequest: { update: vi.fn().mockResolvedValue({ id: 'request-1' }) },
    leadUnlock: { update: vi.fn().mockResolvedValue({ id: 'unlock-1' }) },
    jobStatusEvent: { create: vi.fn().mockResolvedValue({ id: 'status-event-1' }) },
  }
}

describe('selected provider final acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.wallet = { paidCreditBalance: 2, promoCreditBalance: 0, status: 'ACTIVE' }
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
    mockApplyProviderCredit.mockImplementation(async () => {
      state.lead = { ...state.lead, status: 'CREDIT_APPLIED' }
      return {
        ok: true,
        leadId: state.lead.id,
        providerId: state.lead.providerId,
        leadStatus: 'CREDIT_APPLIED',
        requiredCredits: 1,
        currentCreditBalance: Math.max(0, (state.wallet?.paidCreditBalance ?? 0) + (state.wallet?.promoCreditBalance ?? 0) - 1),
        paidCreditBalance: Math.max(0, (state.wallet?.paidCreditBalance ?? 0) - 1),
        promoCreditBalance: state.wallet?.promoCreditBalance ?? 0,
        creditTransactionId: 'ledger-1',
        leadUnlockId: 'unlock-1',
        alreadyApplied: false,
        providerMessage: 'Credit applied.',
      }
    })
  })

  it('records provider acceptance, checks credits, and applies credit without locking the job', async () => {
    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'pwa',
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-1',
      currentCreditBalance: 1,
      creditCheck: {
        ok: true,
        result: 'SUFFICIENT_CREDITS',
        requiredCredits: 1,
      },
      creditApplied: true,
      creditTransactionId: 'ledger-1',
      notificationSent: false,
      creditApplication: {
        leadStatus: 'CREDIT_APPLIED',
        leadUnlockId: 'unlock-1',
      },
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: 'CUSTOMER_SELECTED' },
      data: expect.objectContaining({
        status: 'PROVIDER_ACCEPTED',
        providerAcceptedAt: expect.any(Date),
        respondedAt: expect.any(Date),
      }),
    })
    expect(mockApplyProviderCredit).toHaveBeenCalledWith(
      state.tx,
      expect.objectContaining({
        leadId: 'lead-1',
        providerId: 'provider-1',
        source: 'pwa',
      }),
    )
    expect(state.tx.match.create).not.toHaveBeenCalled()
    expect(state.tx.job.create).not.toHaveBeenCalled()
    expect(state.lead.status).toBe('CREDIT_APPLIED')
    expect(JSON.stringify(result)).not.toContain('customer')
    expect(JSON.stringify(result)).not.toContain('phone')
  })

  it('sets CREDIT_REQUIRED when accepted provider has no credits', async () => {
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'ACTIVE' }

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: true,
      creditCheck: {
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        leadStatus: 'CREDIT_REQUIRED',
        currentCreditBalance: 0,
      },
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] } },
      data: { status: 'CREDIT_REQUIRED' },
    })
  })

  it('is idempotent for duplicate accept after provider accepted', async () => {
    state.lead = makeLead({ status: 'PROVIDER_ACCEPTED' })

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: true,
      alreadyAccepted: true,
      creditCheck: { ok: true },
      creditApplied: true,
      creditTransactionId: 'ledger-1',
    })
    expect(state.tx.lead.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1', status: 'CUSTOMER_SELECTED' } }),
    )
  })

  it('blocks wrong provider, expired lead, cancelled request, and accept after decline', async () => {
    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-2' }))
      .resolves.toEqual({ ok: false, reason: 'PROVIDER_NOT_SELECTED' })

    state.lead = makeLead({ expiresAt: new Date(Date.now() - 60_000) })
    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toEqual({ ok: false, reason: 'LEAD_EXPIRED' })

    state.lead = makeLead({ cancelledAt: new Date(), jobRequest: { ...makeLead().jobRequest, status: 'CANCELLED' } })
    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toEqual({ ok: false, reason: 'REQUEST_CANCELLED' })

    state.lead = makeLead({ status: 'DECLINED' })
    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toEqual({ ok: false, reason: 'LEAD_DECLINED' })
  })
})
