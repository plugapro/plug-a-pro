import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; lead: any; wallet: any } = { tx: null, lead: null, wallet: null }
  const mockDb = { $transaction: vi.fn() }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/lead-unlocks', () => ({
  LEAD_UNLOCK_COST_CREDITS: 1,
  LeadUnlockError: class LeadUnlockError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly currentCreditBalance?: number,
    ) {
      super(message)
      this.name = 'LeadUnlockError'
    }
  },
  unlockLeadForProviderInTransaction: vi.fn().mockResolvedValue({
    unlock: { id: 'unlock-c13' },
    ledgerEntries: [{ id: 'ledger-c13', balanceAfterPaidCredits: 0, balanceAfterPromoCredits: 0 }],
    alreadyUnlocked: false,
  }),
}))
vi.mock('../../lib/provider-lead-access', () => ({
  getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/jobs/signed-token'),
}))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/request/signed-token'),
}))
vi.mock('../../lib/whatsapp', () => ({ sendText: vi.fn().mockResolvedValue('wamid-text') }))
vi.mock('../../lib/whatsapp-interactive', () => ({ sendCtaUrl: vi.fn().mockResolvedValue('wamid-cta') }))
vi.mock('../../lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn((key: string) => (key === 'job_detail' ? 'View job' : 'View details')),
}))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-c13',
    jobRequestId: 'request-c13',
    providerId: 'provider-c13',
    status: 'CUSTOMER_SELECTED',
    expiresAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    customerSelectedAt: new Date('2026-05-07T08:00:00.000Z'),
    providerAcceptedAt: null,
    isTestLead: false,
    cohortName: null,
    unlock: null,
    provider: {
      id: 'provider-c13',
      name: 'Kamo Electrical',
      phone: '+27110000000',
    },
    providerResponses: [
      {
        callOutFee: 350,
        estimatedArrivalAt: new Date('2026-05-07T10:00:00.000Z'),
      },
    ],
    jobRequest: {
      id: 'request-c13',
      category: 'electrical',
      description: 'Lights keep tripping',
      requestedWindowStart: new Date('2026-05-07T10:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-07T12:00:00.000Z'),
      isTestRequest: false,
      cohortName: null,
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-c13',
      selectedLeadInviteId: 'lead-c13',
      customer: { name: 'Thandi', phone: '+27123456789' },
      attachments: [],
      address: {
        street: '2 Oak Avenue',
        addressLine1: null,
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Hatfield',
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
      create: vi.fn().mockResolvedValue({ id: 'audit-c13' }),
    },
    match: { create: vi.fn().mockResolvedValue({ id: 'match-c13' }) },
    quote: { create: vi.fn().mockResolvedValue({ id: 'quote-c13' }) },
    booking: { create: vi.fn().mockResolvedValue({ id: 'booking-c13' }) },
    job: { create: vi.fn().mockResolvedValue({ id: 'job-c13' }) },
    jobRequest: { update: vi.fn().mockResolvedValue({ id: 'request-c13' }) },
    leadUnlock: { update: vi.fn().mockResolvedValue({ id: 'unlock-c13' }) },
    jobStatusEvent: { create: vi.fn().mockResolvedValue({ id: 'status-event-c13' }) },
  }
}

describe('provider final acceptance credit application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.wallet = { paidCreditBalance: 1, promoCreditBalance: 0, status: 'ACTIVE' }
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  it('records PROVIDER_ACCEPTED, applies credit, and locks the selected job', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-c13',
      providerId: 'provider-c13',
      source: 'whatsapp',
      traceId: 'trace-c13',
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-c13',
      creditCheck: { ok: true, result: 'SUFFICIENT_CREDITS' },
      creditApplied: true,
      matchId: 'match-c13',
      jobId: 'job-c13',
      bookingId: 'booking-c13',
      creditTransactionId: 'ledger-c13',
    })
    expect(unlockLeadForProviderInTransaction).toHaveBeenCalledWith(
      state.tx,
      'lead-c13',
      'provider-c13',
      expect.objectContaining({ source: 'whatsapp', traceId: 'trace-c13' }),
    )
    expect(state.tx.match.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobRequestId: 'request-c13',
        providerId: 'provider-c13',
        status: 'QUOTE_APPROVED',
      }),
    })
    expect(state.tx.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-c13',
        providerId: 'provider-c13',
        selectedLeadInviteId: 'lead-c13',
        status: 'SCHEDULED',
      }),
    })
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-c13' },
      data: { status: 'MATCHED' },
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-c13', status: 'CUSTOMER_SELECTED' },
      data: expect.objectContaining({ status: 'PROVIDER_ACCEPTED' }),
    })
  })

  it('keeps customer details locked when credit is required', async () => {
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'ACTIVE' }

    const result = await acceptSelectedProviderJob({ leadId: 'lead-c13', providerId: 'provider-c13' })

    expect(result).toMatchObject({
      ok: true,
      creditCheck: {
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        leadStatus: 'CREDIT_REQUIRED',
      },
    })
    expect(JSON.stringify(result)).not.toContain('Thandi')
    expect(JSON.stringify(result)).not.toContain('+2712')
    expect(JSON.stringify(result)).not.toContain('Oak Avenue')
  })
})
