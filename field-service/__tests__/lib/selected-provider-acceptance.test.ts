import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

const { mockDb, state } = vi.hoisted(() => {
  const state: { tx: any; lead: any } = { tx: null, lead: null }
  const mockDb = {
    $transaction: vi.fn(),
  }
  return { mockDb, state }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/lead-unlocks', async () => {
  class LeadUnlockError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly currentCreditBalance?: number,
    ) {
      super(message)
    }
  }
  return {
    LEAD_UNLOCK_COST_CREDITS: 1,
    LeadUnlockError,
    unlockLeadForProviderInTransaction: vi.fn().mockResolvedValue({
      unlock: { id: 'unlock-1' },
      ledgerEntries: [{ id: 'ledger-1', balanceAfterPaidCredits: 2, balanceAfterPromoCredits: 0 }],
      alreadyUnlocked: false,
    }),
  }
})
vi.mock('../../lib/provider-lead-access', () => ({
  getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.test/jobs/token'),
}))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.test/requests/access/token'),
}))
vi.mock('../../lib/whatsapp', () => ({
  sendText: vi.fn().mockResolvedValue('wamid-1'),
}))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    jobRequestId: 'request-1',
    providerId: 'provider-1',
    status: 'VIEWED',
    isTestLead: false,
    cohortName: null,
    expiresAt: new Date(Date.now() + 60_000),
    customerSelectedAt: new Date('2026-05-02T10:00:00.000Z'),
    unlock: null,
    provider: {
      id: 'provider-1',
      name: 'Alice Plumbing',
      phone: '+27111111111',
      active: true,
      verified: true,
      status: 'ACTIVE',
    },
    providerResponses: [{
      callOutFee: 250,
      estimatedArrivalAt: new Date('2026-05-02T12:00:00.000Z'),
    }],
    jobRequest: {
      id: 'request-1',
      category: 'plumbing',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-1',
      selectedLeadInviteId: 'lead-1',
      description: 'Replace burst geyser valve and check pressure.',
      requestedWindowStart: new Date('2026-05-02T14:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-02T16:00:00.000Z'),
      isTestRequest: false,
      cohortName: null,
      customer: { name: 'Acme Customer', phone: '+27222222222' },
      attachments: [{ id: 'photo-1' }, { id: 'photo-2' }],
      address: {
        street: '12 Hill Crescent',
        addressLine1: null,
        addressLine2: null,
        complexName: 'Ruimsig Heights',
        unitNumber: 'Unit 4',
        suburb: 'Ruimsig',
        city: 'Johannesburg',
        province: 'Gauteng',
        accessNotes: 'Gate code 1234, beware of dog',
      },
      match: null,
    },
    ...overrides,
  }
}

describe('selected provider final acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.lead = makeLead()
    state.tx = {
      lead: {
        findUnique: vi.fn().mockResolvedValue(state.lead),
        update: vi.fn().mockResolvedValue({ id: 'lead-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      providerWallet: {
        findUnique: vi.fn().mockResolvedValue({ paidCreditBalance: 2, promoCreditBalance: 1 }),
      },
      match: {
        create: vi.fn().mockResolvedValue({ id: 'match-1' }),
      },
      leadUnlock: {
        update: vi.fn().mockResolvedValue({ id: 'unlock-1' }),
      },
      quote: {
        create: vi.fn().mockResolvedValue({ id: 'quote-1' }),
      },
      booking: {
        create: vi.fn().mockResolvedValue({ id: 'booking-1' }),
      },
      job: {
        create: vi.fn().mockResolvedValue({ id: 'job-1' }),
      },
      jobRequest: {
        update: vi.fn().mockResolvedValue({ id: 'request-1' }),
      },
      jobStatusEvent: {
        create: vi.fn().mockResolvedValue({ id: 'event-1' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
    mockDb.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(state.tx))
  })

  it('accepts selected provider, debits once through unlock, assigns job, and notifies both parties', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    const { sendText } = await import('../../lib/whatsapp')

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'pwa',
    })

    expect(result).toMatchObject({
      ok: true,
      matchId: 'match-1',
      jobId: 'job-1',
      bookingId: 'booking-1',
      creditTransactionId: 'ledger-1',
      currentCreditBalance: 2,
    })
    expect(unlockLeadForProviderInTransaction).toHaveBeenCalledOnce()
    expect(state.tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'MATCHED' },
    })
    expect(state.tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        providerAcceptedAt: expect.any(Date),
      }),
    })
    expect(sendText).toHaveBeenCalledTimes(2)

    // Provider WhatsApp-complete: full customer details must arrive inline,
    // not only as a "view in PWA" link.
    const providerSend = (sendText as any).mock.calls.find(
      (call: any[]) => call[0]?.to === '+27111111111',
    )?.[0]
    expect(providerSend).toBeDefined()
    expect(providerSend.text).toContain('Acme Customer')
    expect(providerSend.text).toContain('1 credit used')
    expect(providerSend.text).toContain('+27222222222')
    expect(providerSend.text).toContain('12 Hill Crescent')
    expect(providerSend.text).toContain('Ruimsig Heights')
    expect(providerSend.text).toContain('Unit 4')
    expect(providerSend.text).toContain('Gate code 1234')
    expect(providerSend.text).toContain('Reference: LEAD-1')
    expect(providerSend.text).toContain('Preferred time:')
    expect(providerSend.text).toContain('Replace burst geyser valve')
    expect(providerSend.text).toContain('Photos: 2 available')
    expect(providerSend.text).toContain('Example: 14:00')
  })

  it('blocks non-selected provider before credit deduction', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      providerId: 'provider-2',
      jobRequest: {
        ...state.lead.jobRequest,
        selectedProviderId: 'provider-1',
      },
    }))

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-2',
      source: 'api',
    })

    expect(result).toEqual({ ok: false, reason: 'PROVIDER_NOT_SELECTED' })
    expect(unlockLeadForProviderInTransaction).not.toHaveBeenCalled()
  })

  it('maps insufficient credits without creating assignment records', async () => {
    const leadUnlocks = await import('../../lib/lead-unlocks')
    ;(leadUnlocks.unlockLeadForProviderInTransaction as any).mockRejectedValueOnce(
      new leadUnlocks.LeadUnlockError('INSUFFICIENT_CREDITS', 'No credits', 0),
    )

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })

    expect(result).toEqual({ ok: false, reason: 'INSUFFICIENT_CREDITS', currentCreditBalance: 0 })
    expect(state.tx.match.create).not.toHaveBeenCalled()
    expect(state.tx.job.create).not.toHaveBeenCalled()
  })

  it('still accepts when the original 15-min preview window has elapsed but the customer has selected', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      // Original 15-min preview window has long passed.
      expiresAt: new Date(Date.now() - 60_000),
      // But the customer selected this provider afterwards.
      customerSelectedAt: new Date(),
      status: 'VIEWED',
    }))

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })

    expect(result).toMatchObject({ ok: true })
    expect(unlockLeadForProviderInTransaction).toHaveBeenCalledOnce()
  })

  it('rejects acceptance when the lead is explicitly EXPIRED', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      status: 'EXPIRED',
    }))

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })

    expect(result).toEqual({ ok: false, reason: 'LEAD_EXPIRED' })
    expect(unlockLeadForProviderInTransaction).not.toHaveBeenCalled()
  })

  it('does not double-deduct when the same provider re-accepts an already-accepted lead', async () => {
    const { unlockLeadForProviderInTransaction } = await import('../../lib/lead-unlocks')
    state.tx.lead.findUnique.mockResolvedValueOnce(makeLead({
      status: 'ACCEPTED',
      jobRequest: {
        ...makeLead().jobRequest,
        status: 'MATCHED',
        match: {
          id: 'match-1',
          providerId: 'provider-1',
          booking: { id: 'booking-1', job: { id: 'job-1' } },
        },
      },
    }))

    const result = await acceptSelectedProviderJob({
      leadId: 'lead-1',
      providerId: 'provider-1',
      source: 'whatsapp',
    })

    expect(result).toMatchObject({ ok: true, alreadyUnlocked: true })
    expect(unlockLeadForProviderInTransaction).not.toHaveBeenCalled()
    expect(state.tx.match.create).not.toHaveBeenCalled()
  })
})
