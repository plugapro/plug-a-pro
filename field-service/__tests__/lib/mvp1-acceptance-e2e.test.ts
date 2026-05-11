import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

const { mockDb, mockSendTemplate, state } = vi.hoisted(() => {
  const state: {
    lead: any
    wallet: any
    unlock: any
    ledgerEntries: any[]
    auditLogs: any[]
    tx: any
  } = {
    lead: null,
    wallet: null,
    unlock: null,
    ledgerEntries: [],
    auditLogs: [],
    tx: null,
  }
  return {
    state,
    mockSendTemplate: vi.fn(),
    mockDb: {
      $transaction: vi.fn(),
      lead: { findUnique: vi.fn() },
      messageEvent: {
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/whatsapp', () => ({ sendTemplate: mockSendTemplate }))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-e2e-1',
    jobRequestId: 'request-e2e-1',
    providerId: 'provider-e2e-1',
    status: 'CUSTOMER_SELECTED',
    expiresAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    customerSelectedAt: new Date('2026-05-11T10:00:00.000Z'),
    providerAcceptedAt: null,
    isTestLead: false,
    cohortName: null,
    unlock: null,
    provider: {
      id: 'provider-e2e-1',
      name: 'E2E Electrical',
      phone: '+27110000000',
      active: true,
      verified: true,
      status: 'ACTIVE',
      isTestUser: false,
    },
    providerResponses: [
      {
        response: 'INTERESTED',
        callOutFee: 250,
        estimatedArrivalAt: new Date('2026-05-11T12:00:00.000Z'),
      },
    ],
    jobRequest: {
      id: 'request-e2e-1',
      category: 'electrical',
      description: 'Breaker trips',
      requestedWindowStart: new Date('2026-05-11T12:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-11T14:00:00.000Z'),
      isTestRequest: false,
      cohortName: null,
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-e2e-1',
      selectedLeadInviteId: 'lead-e2e-1',
      customer: { name: 'Customer', phone: '+27220000000' },
      attachments: [],
      address: {
        street: '10 Test Road',
        addressLine1: null,
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Ruimsig',
        city: 'Johannesburg',
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
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (args?.where?.id === state.lead.id && args?.data?.status) {
          const expected = args.where.status
          const statusMatches =
            typeof expected === 'string'
              ? expected === state.lead.status
              : Array.isArray(expected?.in)
                ? expected.in.includes(state.lead.status)
                : true
          if (!statusMatches) return { count: 0 }
          state.lead = {
            ...state.lead,
            ...args.data,
            jobRequest: state.lead.jobRequest,
            provider: state.lead.provider,
            unlock: state.lead.unlock,
          }
          return { count: 1 }
        }
        return { count: 0 }
      }),
    },
    jobRequest: {
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (
          args?.where?.id === state.lead.jobRequestId &&
          args?.where?.status === state.lead.jobRequest.status &&
          args?.where?.selectedProviderId === state.lead.providerId &&
          args?.where?.selectedLeadInviteId === state.lead.id
        ) {
          state.lead = {
            ...state.lead,
            jobRequest: { ...state.lead.jobRequest, ...args.data },
          }
          return { count: 1 }
        }
        return { count: 0 }
      }),
    },
    providerWallet: {
      upsert: vi.fn().mockImplementation(async () => state.wallet),
      findUnique: vi.fn().mockImplementation(async () => state.wallet),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        const paidMatches = args?.where?.AND?.some((clause: any) => clause.paidCreditBalance === state.wallet.paidCreditBalance)
        const promoMatches = args?.where?.AND?.some((clause: any) => clause.promoCreditBalance === state.wallet.promoCreditBalance)
        if (!paidMatches || !promoMatches) return { count: 0 }
        state.wallet = {
          ...state.wallet,
          paidCreditBalance: state.wallet.paidCreditBalance - (args.data.paidCreditBalance?.decrement ?? 0),
          promoCreditBalance: state.wallet.promoCreditBalance - (args.data.promoCreditBalance?.decrement ?? 0),
        }
        return { count: 1 }
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => state.wallet),
    },
    leadUnlock: {
      create: vi.fn().mockImplementation(async (args: any) => {
        state.unlock = {
          id: 'unlock-e2e-1',
          ...args.data,
        }
        state.lead = { ...state.lead, unlock: state.unlock }
        return state.unlock
      }),
      update: vi.fn().mockImplementation(async (args: any) => {
        state.unlock = { ...state.unlock, ...args.data }
        state.lead = { ...state.lead, unlock: state.unlock }
        return state.unlock
      }),
    },
    walletLedgerEntry: {
      findFirst: vi.fn().mockImplementation(async () => state.ledgerEntries.at(-1) ?? null),
      create: vi.fn().mockImplementation(async (args: any) => {
        const entry = {
          id: `ledger-e2e-${state.ledgerEntries.length + 1}`,
          ...args.data,
        }
        state.ledgerEntries.push(entry)
        return entry
      }),
    },
    auditLog: {
      create: vi.fn().mockImplementation(async (args: any) => {
        state.auditLogs.push(args.data)
        return { id: `audit-e2e-${state.auditLogs.length}`, ...args.data }
      }),
    },
  }
}

describe('MVP1 selected-provider acceptance end to end', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.wallet = {
      id: 'wallet-e2e-1',
      providerId: 'provider-e2e-1',
      paidCreditBalance: 2,
      promoCreditBalance: 0,
      status: 'ACTIVE',
    }
    state.unlock = null
    state.ledgerEntries = []
    state.auditLogs = []
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
    mockDb.lead.findUnique.mockImplementation(async () => state.lead)
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.messageEvent.create.mockImplementation(async () => ({ id: `message-e2e-${mockDb.messageEvent.create.mock.calls.length}` }))
    mockDb.messageEvent.updateMany.mockResolvedValue({ count: 1 })
    mockSendTemplate.mockResolvedValue('wamid-e2e')
  })

  it('accepts, checks credit, deducts exactly once, locks MVP1 state, and sends basic confirmations', async () => {
    const result = await acceptSelectedProviderJob({
      leadId: 'lead-e2e-1',
      providerId: 'provider-e2e-1',
      source: 'whatsapp',
      traceId: 'trace-e2e-1',
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-e2e-1',
      creditCheck: {
        ok: true,
        result: 'SUFFICIENT_CREDITS',
        requiredCredits: 1,
      },
      creditApplication: {
        leadStatus: 'CREDIT_APPLIED',
        requiredCredits: 1,
        currentCreditBalance: 1,
        creditTransactionId: 'ledger-e2e-1',
        alreadyApplied: false,
      },
      acceptedLock: {
        leadStatus: 'ACCEPTED_LOCKED',
        serviceRequestStatus: 'ACCEPTED_LOCKED',
        creditTransactionId: 'ledger-e2e-1',
        alreadyLocked: false,
      },
      creditApplied: true,
      notificationSent: true,
      matchId: null,
      bookingId: null,
      jobId: null,
    })
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')
    expect(state.lead.jobRequest.status).toBe('ACCEPTED_LOCKED')
    expect(state.wallet.paidCreditBalance).toBe(1)
    expect(state.ledgerEntries).toHaveLength(1)
    expect(state.ledgerEntries[0]).toMatchObject({
      entryType: 'LEAD_UNLOCK_DEBIT',
      providerId: 'provider-e2e-1',
      referenceType: 'selected_lead_credit_application',
      referenceId: 'lead-e2e-1',
      idempotencyKey: 'selected_lead_credit_application:provider-e2e-1:lead-e2e-1',
    })
    expect(state.auditLogs.map((log) => log.action)).toEqual([
      'shortlist.selected_provider_accept',
      'lead.provider_credit_check_passed',
      'lead.provider_credit_applied',
      'lead.provider_accepted_locked',
    ])
    expect(mockSendTemplate).toHaveBeenCalledTimes(2)
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27220000000',
      template: 'mvp1_accepted_lock_customer_confirmation',
    }))
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27110000000',
      template: 'mvp1_accepted_lock_provider_confirmation',
    }))
  })

  it('replays duplicate accept without a second credit deduction or duplicate confirmation', async () => {
    const first = await acceptSelectedProviderJob({
      leadId: 'lead-e2e-1',
      providerId: 'provider-e2e-1',
      source: 'whatsapp',
    })
    const second = await acceptSelectedProviderJob({
      leadId: 'lead-e2e-1',
      providerId: 'provider-e2e-1',
      source: 'pwa',
    })

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({
      ok: true,
      alreadyAccepted: true,
      alreadyUnlocked: true,
      creditApplied: true,
      notificationSent: false,
    })
    expect(state.wallet.paidCreditBalance).toBe(1)
    expect(state.ledgerEntries).toHaveLength(1)
    expect(mockSendTemplate).toHaveBeenCalledTimes(2)
  })

  it('completes the full lock when the provider retries after topping up from CREDIT_REQUIRED', async () => {
    state.lead = makeLead({
      status: 'CREDIT_REQUIRED',
      providerAcceptedAt: new Date('2026-05-11T10:30:00.000Z'),
    })

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-e2e-1',
      providerId: 'provider-e2e-1',
      source: 'whatsapp',
      traceId: 'trace-e2e-retry',
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-e2e-1',
      alreadyAccepted: true,
      creditApplied: true,
      acceptedLock: {
        leadStatus: 'ACCEPTED_LOCKED',
        serviceRequestStatus: 'ACCEPTED_LOCKED',
        alreadyLocked: false,
      },
      notificationSent: true,
    })
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')
    expect(state.lead.jobRequest.status).toBe('ACCEPTED_LOCKED')
    expect(state.wallet.paidCreditBalance).toBe(1)
    expect(state.ledgerEntries).toHaveLength(1)
    expect(state.auditLogs.map((log: { action: string }) => log.action)).toEqual([
      'lead.provider_credit_check_passed',
      'lead.provider_credit_applied',
      'lead.provider_accepted_locked',
    ])
    expect(mockSendTemplate).toHaveBeenCalledTimes(2)
  })
})
