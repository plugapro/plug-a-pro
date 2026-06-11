import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; lead: any; wallet: any } = { tx: null, lead: null, wallet: null }
  const mockDb = { $transaction: vi.fn() }
  return { mockDb, state }
})
const mockApplyProviderCredit = vi.hoisted(() => vi.fn())
const mockLockAcceptedLead = vi.hoisted(() => vi.fn())
const mockNotifyAcceptedLeadLocked = vi.hoisted(() => vi.fn())
const { mockAssertIdentityVerifiedForCredits, MockIdentityCreditGateError } = vi.hoisted(() => {
  class MockIdentityCreditGateError extends Error {
    readonly code = 'IDENTITY_NOT_VERIFIED'

    constructor() {
      super('High-assurance identity verification is required before purchasing credits.')
      this.name = 'IdentityCreditGateError'
    }
  }

  return {
    mockAssertIdentityVerifiedForCredits: vi.fn(),
    MockIdentityCreditGateError,
  }
})

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
vi.mock('../../lib/provider-accepted-lock', () => ({
  AcceptedLeadLockError: class AcceptedLeadLockError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message)
      this.name = 'AcceptedLeadLockError'
    }
  },
  lockAcceptedLeadAfterCreditInTransaction: mockLockAcceptedLead,
  notifyAcceptedLeadLocked: mockNotifyAcceptedLeadLocked,
  notifyNonSelectedRfpProviders: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/identity-verification/credit-gate', () => ({
  IdentityCreditGateError: MockIdentityCreditGateError,
  assertIdentityVerifiedForCredits: mockAssertIdentityVerifiedForCredits,
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
    mockLockAcceptedLead.mockImplementation(async () => {
      state.lead = { ...state.lead, status: 'ACCEPTED_LOCKED' }
      return {
        ok: true,
        leadId: state.lead.id,
        providerId: state.lead.providerId,
        serviceRequestId: state.lead.jobRequestId,
        leadStatus: 'ACCEPTED_LOCKED',
        serviceRequestStatus: 'ACCEPTED_LOCKED',
        creditTransactionId: 'ledger-1',
        alreadyLocked: false,
        notificationPayload: { leadId: state.lead.id, providerId: state.lead.providerId },
      }
    })
    mockNotifyAcceptedLeadLocked.mockResolvedValue(true)
    mockAssertIdentityVerifiedForCredits.mockResolvedValue({ providerId: 'provider-1', verificationId: 'ver-1' })
  })

  it('records provider acceptance, checks credits, applies credit and locks the job', async () => {
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
      matchId: null,
      bookingId: null,
      jobId: null,
      notificationSent: true,
      creditApplication: {
        leadStatus: 'CREDIT_APPLIED',
        leadUnlockId: 'unlock-1',
      },
      acceptedLock: {
        leadStatus: 'ACCEPTED_LOCKED',
        serviceRequestStatus: 'ACCEPTED_LOCKED',
        creditTransactionId: 'ledger-1',
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
    expect(mockLockAcceptedLead).toHaveBeenCalledWith(
      state.tx,
      expect.objectContaining({
        leadId: 'lead-1',
        providerId: 'provider-1',
        source: 'pwa',
        currentCreditBalance: 1,
      }),
    )
    expect(mockNotifyAcceptedLeadLocked).toHaveBeenCalledWith({ leadId: 'lead-1', providerId: 'provider-1' })
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')
    expect(JSON.stringify(result)).not.toContain('customer')
    expect(JSON.stringify(result)).not.toContain('phone')
  })

  it('runs the acceptance workflow with an extended transaction timeout', async () => {
    await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1', source: 'pwa' })

    expect(mockDb.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: 10_000,
        timeout: 20_000,
      }),
    )
  })

  it('returns failure (not success) and spends no credit when accepted provider has no credits', async () => {
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'ACTIVE' }

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    // SECURITY (66b2eee9): a failed credit check must NOT report success — the
    // lead stays in CREDIT_REQUIRED with no credit spent, so the outer accept
    // must surface a failure shape the callers treat as not-accepted.
    expect(result).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
      creditCheck: {
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        leadStatus: 'CREDIT_REQUIRED',
        currentCreditBalance: 0,
      },
    })
    // Lead is parked in CREDIT_REQUIRED (non-final, locked-pending) ...
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] } },
      data: { status: 'CREDIT_REQUIRED' },
    })
    // ... and no credit was applied / no lock taken.
    expect(mockApplyProviderCredit).not.toHaveBeenCalled()
    expect(mockLockAcceptedLead).not.toHaveBeenCalled()
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
      matchId: null,
      jobId: null,
    })
    expect(state.tx.lead.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead-1', status: 'CUSTOMER_SELECTED' } }),
    )
  })

  it('is idempotent for duplicate accept after the job is already locked', async () => {
    state.lead = makeLead({
      status: 'ACCEPTED_LOCKED',
      unlock: { id: 'unlock-1', providerId: 'provider-1' },
    })
    mockLockAcceptedLead.mockImplementationOnce(async () => ({
      ok: true,
      leadId: 'lead-1',
      providerId: 'provider-1',
      serviceRequestId: 'request-1',
      leadStatus: 'ACCEPTED_LOCKED',
      serviceRequestStatus: 'ACCEPTED_LOCKED',
      creditTransactionId: 'ledger-1',
      alreadyLocked: true,
      notificationPayload: null,
    }))

    const result = await acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: true,
      alreadyAccepted: true,
      alreadyUnlocked: true,
      creditApplied: true,
      matchId: null,
      notificationSent: false,
    })
    expect(mockApplyProviderCredit).toHaveBeenCalledTimes(1)
    expect(mockLockAcceptedLead).toHaveBeenCalledTimes(1)
    expect(mockNotifyAcceptedLeadLocked).not.toHaveBeenCalled()
  })

  it('blocks wrong provider, expired lead, cancelled request and accept after decline', async () => {
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

  it('blocks selected-provider final acceptance before credit checks when identity is not verified', async () => {
    mockAssertIdentityVerifiedForCredits.mockRejectedValueOnce(new MockIdentityCreditGateError())

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })

    expect(result).toEqual({ ok: false, reason: 'IDENTITY_NOT_VERIFIED' })
    expect(mockAssertIdentityVerifiedForCredits).toHaveBeenCalledWith('provider-1', state.tx)
    expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
    expect(state.tx.auditLog.create).not.toHaveBeenCalled()
    expect(state.tx.providerWallet.findUnique).not.toHaveBeenCalled()
    expect(mockApplyProviderCredit).not.toHaveBeenCalled()
    expect(mockLockAcceptedLead).not.toHaveBeenCalled()
    expect(mockNotifyAcceptedLeadLocked).not.toHaveBeenCalled()
    expect(state.lead.status).toBe('CUSTOMER_SELECTED')
  })

  it('blocks accept when the service request expiry has passed', async () => {
    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        expiresAt: new Date(Date.now() - 60_000),
      },
    })

    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toEqual({ ok: false, reason: 'LEAD_EXPIRED' })
    expect(mockApplyProviderCredit).not.toHaveBeenCalled()
    expect(mockLockAcceptedLead).not.toHaveBeenCalled()
  })

  it('does not create an accept audit event when a conflicting decline wins first', async () => {
    state.tx.lead.updateMany.mockResolvedValueOnce({ count: 0 })
    state.tx.lead.findUnique = vi
      .fn()
      .mockResolvedValueOnce(makeLead())
      .mockResolvedValueOnce({ status: 'DECLINED' })

    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toEqual({ ok: false, reason: 'LEAD_DECLINED' })
    expect(state.tx.auditLog.create).not.toHaveBeenCalled()
    expect(mockApplyProviderCredit).not.toHaveBeenCalled()
  })

  it('blocks accept when the lead is already locked without reprocessing workflow 6', async () => {
    state.lead = makeLead({ status: 'ACCEPTED_LOCKED' })

    await expect(acceptSelectedProviderJob({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toEqual({ ok: false, reason: 'LEAD_ALREADY_ACCEPTED' })
    expect(mockApplyProviderCredit).not.toHaveBeenCalled()
    expect(mockLockAcceptedLead).not.toHaveBeenCalled()
  })

  it('blocks a competing provider accept after the request is accepted locked', async () => {
    state.lead = makeLead({
      id: 'lead-2',
      providerId: 'provider-2',
      status: 'CUSTOMER_SELECTED',
      jobRequest: {
        ...makeLead().jobRequest,
        status: 'ACCEPTED_LOCKED',
        selectedProviderId: 'provider-1',
        selectedLeadInviteId: 'lead-1',
      },
    })

    await expect(acceptSelectedProviderJob({ leadId: 'lead-2', providerId: 'provider-2' }))
      .resolves.toEqual({ ok: false, reason: 'PROVIDER_NOT_SELECTED' })
    expect(mockApplyProviderCredit).not.toHaveBeenCalled()
    expect(mockLockAcceptedLead).not.toHaveBeenCalled()
  })
})
