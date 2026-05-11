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
  unlockLeadForProviderInTransaction: vi.fn(),
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
    unlock: null,
    jobRequest: {
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-c13',
      selectedLeadInviteId: 'lead-c13',
    },
    ...overrides,
  }
}

function makeTx() {
  return {
    lead: {
      findUnique: vi.fn().mockImplementation(async () => state.lead),
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
    match: { create: vi.fn() },
    quote: { create: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn() },
    jobRequest: { update: vi.fn() },
  }
}

describe('provider final acceptance before credit application', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.wallet = { paidCreditBalance: 1, promoCreditBalance: 0, status: 'ACTIVE' }
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  it('records PROVIDER_ACCEPTED and checks credits without deducting or locking the lead', async () => {
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
    })
    expect(unlockLeadForProviderInTransaction).not.toHaveBeenCalled()
    expect(state.tx.match.create).not.toHaveBeenCalled()
    expect(state.tx.job.create).not.toHaveBeenCalled()
    expect(state.tx.jobRequest.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'MATCHED' } }),
    )
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
