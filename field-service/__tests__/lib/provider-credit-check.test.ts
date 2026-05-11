import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkProviderLeadCreditBalance } from '../../lib/provider-credit-check'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; lead: any; wallet: any } = {
    tx: null,
    lead: null,
    wallet: null,
  }
  const mockDb = { $transaction: vi.fn() }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/lead-unlocks', () => ({ LEAD_UNLOCK_COST_CREDITS: 1 }))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    providerId: 'provider-1',
    status: 'PROVIDER_ACCEPTED',
    expiresAt: new Date(Date.now() + 60_000),
    cancelledAt: null,
    unlock: null,
    provider: { id: 'provider-1' },
    jobRequest: {
      status: 'PROVIDER_CONFIRMATION_PENDING',
      expiresAt: new Date(Date.now() + 60_000),
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    providerWallet: {
      findUnique: vi.fn().mockImplementation(async () => state.wallet),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  }
}

describe('provider lead credit balance check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.wallet = { paidCreditBalance: 2, promoCreditBalance: 1, status: 'ACTIVE' }
    state.tx = makeTx()
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  it('passes when provider has enough credits', async () => {
    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: true,
      result: 'SUFFICIENT_CREDITS',
      requiredCredits: 1,
      currentCreditBalance: 3,
      leadStatus: 'PROVIDER_ACCEPTED',
    })
    expect(state.tx.lead.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CREDIT_REQUIRED' } }),
    )
    expect(state.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'lead.provider_credit_check_passed' }),
      }),
    )
  })

  it('returns NOT_FOUND when the lead is missing', async () => {
    state.lead = null

    const result = await checkProviderLeadCreditBalance({ leadId: 'missing-lead', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'NOT_FOUND',
      providerId: 'provider-1',
    })
    expect(state.tx.providerWallet.findUnique).not.toHaveBeenCalled()
    expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
  })

  it('returns PROVIDER_NOT_FOUND when the lead provider relation is missing', async () => {
    state.lead = makeLead({ provider: null })

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'PROVIDER_NOT_FOUND',
      leadStatus: 'PROVIDER_ACCEPTED',
    })
    expect(state.tx.providerWallet.findUnique).not.toHaveBeenCalled()
    expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
  })

  it('sets CREDIT_REQUIRED when provider has zero credits', async () => {
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'ACTIVE' }

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
      leadStatus: 'CREDIT_REQUIRED',
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] } },
      data: { status: 'CREDIT_REQUIRED' },
    })
  })

  it('handles a missing provider wallet cleanly', async () => {
    state.wallet = null

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'WALLET_MISSING',
      currentCreditBalance: 0,
      leadStatus: 'CREDIT_REQUIRED',
    })
  })

  it('sets CREDIT_REQUIRED when provider has insufficient credits', async () => {
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'ACTIVE' }

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      currentCreditBalance: 0,
      leadStatus: 'CREDIT_REQUIRED',
    })
  })

  it('blocks the wrong provider', async () => {
    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-2' })

    expect(result).toMatchObject({ ok: false, reason: 'PROVIDER_NOT_SELECTED' })
    expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
  })

  it('blocks leads that are not accepted yet', async () => {
    state.lead = makeLead({ status: 'CUSTOMER_SELECTED' })

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({ ok: false, reason: 'LEAD_NOT_ACCEPTED' })
    expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
  })

  it('blocks expired and cancelled leads', async () => {
    state.lead = makeLead({ expiresAt: new Date(Date.now() - 60_000) })

    await expect(checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toMatchObject({ ok: false, reason: 'LEAD_EXPIRED' })

    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        expiresAt: new Date(Date.now() - 60_000),
      },
    })
    await expect(checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toMatchObject({ ok: false, reason: 'LEAD_EXPIRED' })

    state.lead = makeLead({ cancelledAt: new Date(), jobRequest: { ...makeLead().jobRequest, status: 'CANCELLED' } })
    await expect(checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' }))
      .resolves.toMatchObject({ ok: false, reason: 'REQUEST_CANCELLED' })
  })

  it('treats negative wallet balances defensively and does not expose customer details', async () => {
    state.wallet = { paidCreditBalance: -5, promoCreditBalance: 1, status: 'ACTIVE' }

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'CORRUPT_CREDIT_BALANCE',
      currentCreditBalance: 0,
      leadStatus: 'CREDIT_REQUIRED',
    })
    expect(JSON.stringify(result)).not.toContain('customer')
    expect(JSON.stringify(result)).not.toContain('phone')
    expect(state.tx.lead.findUnique).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      select: expect.not.objectContaining({
        customer: expect.anything(),
        jobRequest: expect.objectContaining({
          select: expect.objectContaining({
            customer: expect.anything(),
          }),
        }),
      }),
    })
  })

  it('treats a negative component balance as corrupt even when total balance is positive', async () => {
    state.wallet = { paidCreditBalance: -2, promoCreditBalance: 5, status: 'ACTIVE' }

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'CORRUPT_CREDIT_BALANCE',
      currentCreditBalance: 0,
      paidCreditBalance: 0,
      promoCreditBalance: 0,
      leadStatus: 'CREDIT_REQUIRED',
    })
    expect(JSON.stringify(result)).not.toContain('customer')
    expect(JSON.stringify(result)).not.toContain('phone')
  })

  it('returns a retry-safe failure when wallet lookup fails', async () => {
    state.tx.providerWallet.findUnique.mockRejectedValueOnce(new Error('wallet database timeout'))

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'WALLET_QUERY_FAILED',
      leadStatus: 'PROVIDER_ACCEPTED',
      providerMessage: expect.stringContaining('could not check your credit balance'),
    })
    expect(state.tx.lead.updateMany).not.toHaveBeenCalled()
    expect(state.tx.auditLog.create).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('wallet database timeout')
  })

  it('keeps duplicate insufficient-credit checks idempotent', async () => {
    state.lead = makeLead({ status: 'CREDIT_REQUIRED' })
    state.wallet = { paidCreditBalance: 0, promoCreditBalance: 0, status: 'ACTIVE' }

    const result = await checkProviderLeadCreditBalance({ leadId: 'lead-1', providerId: 'provider-1' })

    expect(result).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_CREDITS',
      leadStatus: 'CREDIT_REQUIRED',
    })
    expect(state.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] } },
      data: { status: 'CREDIT_REQUIRED' },
    })
    expect(state.tx.auditLog.create).not.toHaveBeenCalled()
  })
})
