import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; lead: any; wallet: any } = { tx: null, lead: null, wallet: null }
  const mockDb = { $transaction: vi.fn() }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/lead-unlocks', () => ({ LEAD_UNLOCK_COST_CREDITS: 1 }))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    jobRequestId: 'request-1',
    providerId: 'provider-1',
    status: 'CUSTOMER_SELECTED',
    expiresAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    customerSelectedAt: new Date('2026-05-02T10:00:00.000Z'),
    unlock: null,
    jobRequest: {
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
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
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    match: { create: vi.fn() },
    quote: { create: vi.fn() },
    booking: { create: vi.fn() },
    job: { create: vi.fn() },
    jobRequest: { update: vi.fn() },
    leadUnlock: { update: vi.fn() },
  }
}

describe('selected provider final acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.wallet = { paidCreditBalance: 2, promoCreditBalance: 0, status: 'ACTIVE' }
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  it('records provider acceptance, runs credit check, and does not unlock or expose contact details', async () => {
    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'pwa',
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-1',
      currentCreditBalance: 2,
      creditCheck: {
        ok: true,
        result: 'SUFFICIENT_CREDITS',
        requiredCredits: 1,
      },
      notificationSent: false,
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: 'CUSTOMER_SELECTED' },
      data: expect.objectContaining({
        status: 'PROVIDER_ACCEPTED',
        providerAcceptedAt: expect.any(Date),
        respondedAt: expect.any(Date),
      }),
    })
    expect(state.tx.match.create).not.toHaveBeenCalled()
    expect(state.tx.job.create).not.toHaveBeenCalled()
    expect(state.tx.leadUnlock.update).not.toHaveBeenCalled()
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
