import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AcceptedLeadLockError,
  lockAcceptedLeadAfterCreditInTransaction,
} from '../../lib/provider-accepted-lock'

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-lock-1',
    jobRequestId: 'request-lock-1',
    providerId: 'provider-lock-1',
    status: 'CREDIT_APPLIED',
    cancelledAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    providerAcceptedAt: new Date('2026-05-10T08:00:00.000Z'),
    isTestLead: false,
    cohortName: null,
    unlock: { id: 'unlock-lock-1', providerId: 'provider-lock-1' },
    provider: { id: 'provider-lock-1', name: 'Apex Plumbing', phone: '+27110000000' },
    providerResponses: [
      {
        response: 'INTERESTED',
        callOutFee: 300,
        estimatedArrivalAt: new Date('2026-05-10T10:00:00.000Z'),
      },
    ],
    jobRequest: {
      id: 'request-lock-1',
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: 'provider-lock-1',
      selectedLeadInviteId: 'lead-lock-1',
      category: 'plumbing',
      description: 'Kitchen leak',
      requestedWindowStart: new Date('2026-05-10T10:00:00.000Z'),
      requestedWindowEnd: new Date('2026-05-10T12:00:00.000Z'),
      expiresAt: new Date(Date.now() + 60_000),
      isTestRequest: false,
      cohortName: null,
      customer: { name: 'Thandi Customer', phone: '+27220000000' },
      address: {
        street: '1 Oak Avenue',
        addressLine1: null,
        addressLine2: null,
        complexName: null,
        unitNumber: null,
        suburb: 'Sunnyside',
        city: 'Pretoria',
        province: 'Gauteng',
        accessNotes: 'Gate 2',
      },
      attachments: [{ id: 'photo-1' }],
      match: null,
    },
    ...overrides,
  }
}

function makeTx(state: { lead: any; wallet: any; ledger: any }) {
  return {
    lead: {
      findUnique: vi.fn().mockImplementation(async () => state.lead),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (args?.where?.id === state.lead.id && args?.where?.status === state.lead.status && args?.data?.status) {
          state.lead = { ...state.lead, status: args.data.status }
          return { count: 1 }
        }
        return { count: 1 }
      }),
    },
    jobRequest: {
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (
          args?.where?.id === state.lead.jobRequestId &&
          args?.where?.status === state.lead.jobRequest.status &&
          args?.data?.status
        ) {
          state.lead = {
            ...state.lead,
            jobRequest: { ...state.lead.jobRequest, status: args.data.status },
          }
          return { count: 1 }
        }
        return { count: 0 }
      }),
    },
    providerWallet: {
      findUnique: vi.fn().mockImplementation(async () => state.wallet),
    },
    walletLedgerEntry: {
      findFirst: vi.fn().mockImplementation(async () => state.ledger),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-lock-1' }),
    },
    match: {
      create: vi.fn().mockResolvedValue({ id: 'match-lock-1' }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    quote: {
      create: vi.fn().mockResolvedValue({ id: 'quote-lock-1' }),
    },
    booking: {
      create: vi.fn(),
    },
    job: {
      create: vi.fn(),
    },
  }
}

describe('provider accepted lock', () => {
  let state: { lead: any; wallet: any; ledger: any }
  let tx: ReturnType<typeof makeTx>

  beforeEach(() => {
    vi.clearAllMocks()
    state = {
      lead: makeLead(),
      wallet: { paidCreditBalance: 4, promoCreditBalance: 0 },
      ledger: { id: 'ledger-lock-1', providerId: 'provider-lock-1' },
    }
    tx = makeTx(state)
  })

  it('locks the lead and service request as ACCEPTED_LOCKED after credit is applied', async () => {
    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, {
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
      source: 'whatsapp',
      traceId: 'trace-lock-1',
      currentCreditBalance: 3,
      paidCreditBalance: 3,
      promoCreditBalance: 0,
    })

    expect(result).toMatchObject({
      ok: true,
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
      serviceRequestId: 'request-lock-1',
      leadStatus: 'ACCEPTED_LOCKED',
      serviceRequestStatus: 'ACCEPTED_LOCKED',
      creditTransactionId: 'ledger-lock-1',
      alreadyLocked: false,
      notificationPayload: {
        providerPhone: '+27110000000',
        customerPhone: '+27220000000',
        currentCreditBalance: 3,
      },
    })
    expect(tx.jobRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-lock-1',
        status: 'PROVIDER_CONFIRMATION_PENDING',
        selectedProviderId: 'provider-lock-1',
        selectedLeadInviteId: 'lead-lock-1',
      },
      data: { status: 'ACCEPTED_LOCKED' },
    })
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-lock-1', status: 'CREDIT_APPLIED', providerId: 'provider-lock-1' },
      data: expect.objectContaining({ status: 'ACCEPTED_LOCKED' }),
    })
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: {
        jobRequestId: 'request-lock-1',
        id: { not: 'lead-lock-1' },
        status: { in: ['SEND_PENDING', 'SEND_FAILED'] },
      },
      data: { status: 'SUPERSEDED' },
    })
    expect(tx.lead.updateMany).toHaveBeenCalledWith({
      where: {
        jobRequestId: 'request-lock-1',
        id: { not: 'lead-lock-1' },
        status: { in: ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED'] },
      },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'lead.provider_accepted_locked',
        entityId: 'lead-lock-1',
      }),
    })
    // Post-lock fulfilment artifacts: Match + stub Quote are now created
    // inside the lock transaction so /provider/jobs can surface the work.
    // Booking + Job remain deferred until the provider submits a real quote
    // and the customer approves it (Phase 1b).
    expect(tx.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobRequestId: 'request-lock-1',
          providerId: 'provider-lock-1',
          status: 'MATCHED',
        }),
      }),
    )
    expect(tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchId: 'match-lock-1',
          status: 'PENDING',
          description: 'Awaiting provider quote',
        }),
      }),
    )
    expect(tx.booking.create).not.toHaveBeenCalled()
    expect(tx.job.create).not.toHaveBeenCalled()
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')
    expect(state.lead.jobRequest.status).toBe('ACCEPTED_LOCKED')
  })

  it('blocks when the lead is missing', async () => {
    state.lead = null

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'missing-lead',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({
      name: 'AcceptedLeadLockError',
      code: 'NOT_FOUND',
    } satisfies Partial<AcceptedLeadLockError>)
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('replays duplicate lock calls idempotently', async () => {
    state.lead = makeLead({
      status: 'ACCEPTED_LOCKED',
      jobRequest: {
        ...makeLead().jobRequest,
        status: 'ACCEPTED_LOCKED',
      },
    })

    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, {
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      leadStatus: 'ACCEPTED_LOCKED',
      serviceRequestStatus: 'ACCEPTED_LOCKED',
      creditTransactionId: 'ledger-lock-1',
      alreadyLocked: true,
      notificationPayload: null,
    })
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
    expect(tx.lead.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('blocks inconsistent partial accepted-lock state instead of replaying it', async () => {
    state.lead = makeLead({
      status: 'ACCEPTED_LOCKED',
      jobRequest: {
        ...makeLead().jobRequest,
        status: 'PROVIDER_CONFIRMATION_PENDING',
      },
    })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({
      name: 'AcceptedLeadLockError',
      code: 'ACCEPTED_LOCK_FAILED',
    } satisfies Partial<AcceptedLeadLockError>)
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks lock attempts before the credit transaction has been applied', async () => {
    state.lead = makeLead({ status: 'PROVIDER_ACCEPTED', unlock: null })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({
      name: 'AcceptedLeadLockError',
      code: 'CREDIT_NOT_APPLIED',
    } satisfies Partial<AcceptedLeadLockError>)
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks lock attempts when the credit ledger transaction is missing', async () => {
    state.ledger = null

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({
      name: 'AcceptedLeadLockError',
      code: 'CREDIT_TRANSACTION_MISSING',
    } satisfies Partial<AcceptedLeadLockError>)
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks another provider from locking the selected lead', async () => {
    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-other',
      }),
    ).rejects.toMatchObject({
      name: 'AcceptedLeadLockError',
      code: 'PROVIDER_NOT_SELECTED',
    } satisfies Partial<AcceptedLeadLockError>)
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks lock when the request is cancelled', async () => {
    state.lead = makeLead({ jobRequest: { ...makeLead().jobRequest, status: 'CANCELLED' } })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks lock when the lead is expired', async () => {
    state.lead = makeLead({ status: 'EXPIRED' })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'LEAD_EXPIRED' })
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks lock when the request expiry has passed', async () => {
    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'LEAD_EXPIRED' })
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('blocks lock when the request is already locked to a different provider', async () => {
    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        match: { id: 'match-other', providerId: 'provider-other', status: 'MATCHED' },
      },
    })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'LEAD_ALREADY_LOCKED' })
    expect(tx.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('throws ACCEPTED_LOCK_FAILED on concurrent request race', async () => {
    tx.jobRequest.updateMany = vi.fn().mockResolvedValue({ count: 0 })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'ACCEPTED_LOCK_FAILED' })
  })

  it('throws ACCEPTED_LOCK_FAILED on concurrent lead race after request update', async () => {
    tx.lead.updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'ACCEPTED_LOCK_FAILED' })
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('keeps customer phone and address isolated in notificationPayload, not in root result', async () => {
    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, {
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    const rootJson = JSON.stringify({ ...result, notificationPayload: undefined })
    expect(rootJson).not.toContain('+27220000000')
    expect(rootJson).not.toContain('Thandi Customer')
    expect(rootJson).not.toContain('1 Oak Avenue')
    expect(result.notificationPayload?.customerPhone).toBe('+27220000000')
    expect(result.notificationPayload?.customerName).toBe('Thandi Customer')
  })
})
