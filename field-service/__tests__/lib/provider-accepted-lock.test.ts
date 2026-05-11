import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AcceptedLeadLockError,
  lockAcceptedLeadAfterCreditInTransaction,
  notifyAcceptedLeadLocked,
} from '../../lib/provider-accepted-lock'

const { mockSendText, mockSendCtaUrl } = vi.hoisted(() => ({
  mockSendText: vi.fn(),
  mockSendCtaUrl: vi.fn(),
}))

vi.mock('../../lib/provider-lead-access', () => ({
  getProviderLeadAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/leads/access/signed-token'),
}))
vi.mock('../../lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/request/signed-token'),
}))
vi.mock('../../lib/whatsapp', () => ({ sendText: mockSendText }))
vi.mock('../../lib/whatsapp-interactive', () => ({ sendCtaUrl: mockSendCtaUrl }))
vi.mock('../../lib/whatsapp-copy', () => ({
  ctaLabelFor: vi.fn((key: string) => (key === 'job_detail' ? 'View job' : 'View details')),
}))

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-lock-1',
    jobRequestId: 'request-lock-1',
    providerId: 'provider-lock-1',
    status: 'CREDIT_APPLIED',
    cancelledAt: null,
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
      create: vi.fn(),
    },
    quote: {
      create: vi.fn(),
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
    mockSendText.mockResolvedValue('wamid-text')
    mockSendCtaUrl.mockResolvedValue('wamid-cta')
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
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'lead.provider_accepted_locked',
        entityId: 'lead-lock-1',
      }),
    })
    expect(tx.match.create).not.toHaveBeenCalled()
    expect(tx.quote.create).not.toHaveBeenCalled()
    expect(tx.booking.create).not.toHaveBeenCalled()
    expect(tx.job.create).not.toHaveBeenCalled()
    expect(state.lead.status).toBe('ACCEPTED_LOCKED')
    expect(state.lead.jobRequest.status).toBe('ACCEPTED_LOCKED')
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

  it('does not undo accepted lock if notification delivery fails after commit', async () => {
    mockSendText.mockRejectedValueOnce(new Error('whatsapp unavailable'))
    const payload = {
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
      providerPhone: '+27110000000',
      customerPhone: '+27220000000',
      customerName: 'Thandi Customer',
      providerName: 'Apex Plumbing',
      category: 'plumbing',
      requestId: 'request-lock-1',
      description: 'Kitchen leak',
      preferredWindowStart: new Date('2026-05-10T10:00:00.000Z'),
      preferredWindowEnd: new Date('2026-05-10T12:00:00.000Z'),
      photosCount: 1,
      estimatedArrivalAt: null,
      callOutFee: 300,
      currentCreditBalance: 3,
      paidCreditBalance: 3,
      promoCreditBalance: 0,
      address: makeLead().jobRequest.address,
    }

    await expect(notifyAcceptedLeadLocked(payload)).resolves.toBe(false)
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
