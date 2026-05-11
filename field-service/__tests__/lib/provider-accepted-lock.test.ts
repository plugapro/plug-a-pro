import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AcceptedLeadLockError,
  lockAcceptedLeadAfterCreditInTransaction,
} from '../../lib/provider-accepted-lock'

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

function makeTx(state: { lead: any; wallet: any }) {
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
    providerWallet: {
      findUnique: vi.fn().mockImplementation(async () => state.wallet),
    },
    match: {
      create: vi.fn().mockResolvedValue({ id: 'match-lock-1' }),
    },
    leadUnlock: {
      update: vi.fn().mockResolvedValue({ id: 'unlock-lock-1' }),
    },
    quote: {
      create: vi.fn().mockResolvedValue({ id: 'quote-lock-1' }),
    },
    booking: {
      create: vi.fn().mockResolvedValue({ id: 'booking-lock-1' }),
    },
    job: {
      create: vi.fn().mockResolvedValue({ id: 'job-lock-1' }),
    },
    jobRequest: {
      update: vi.fn().mockResolvedValue({ id: 'request-lock-1' }),
    },
    jobStatusEvent: {
      create: vi.fn().mockResolvedValue({ id: 'event-lock-1' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-lock-1' }),
    },
  }
}

describe('provider accepted lock', () => {
  let state: { lead: any; wallet: any }
  let tx: ReturnType<typeof makeTx>

  beforeEach(() => {
    vi.clearAllMocks()
    state = {
      lead: makeLead(),
      wallet: { paidCreditBalance: 4, promoCreditBalance: 0 },
    }
    tx = makeTx(state)
  })

  it('creates the match, quote, booking, job, audit event, and ACCEPTED lead state exactly after credit is applied', async () => {
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
      matchId: 'match-lock-1',
      bookingId: 'booking-lock-1',
      jobId: 'job-lock-1',
      alreadyLocked: false,
      notificationPayload: {
        providerPhone: '+27110000000',
        customerPhone: '+27220000000',
        currentCreditBalance: 3,
      },
    })
    expect(tx.match.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobRequestId: 'request-lock-1',
        providerId: 'provider-lock-1',
        status: 'QUOTE_APPROVED',
      }),
    })
    expect(tx.leadUnlock.update).toHaveBeenCalledWith({
      where: { id: 'unlock-lock-1' },
      data: { matchId: 'match-lock-1' },
    })
    expect(tx.quote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matchId: 'match-lock-1', status: 'APPROVED' }),
    })
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ matchId: 'match-lock-1', quoteId: 'quote-lock-1', status: 'SCHEDULED' }),
    })
    expect(tx.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking-lock-1',
        providerId: 'provider-lock-1',
        selectedLeadInviteId: 'lead-lock-1',
        status: 'SCHEDULED',
      }),
    })
    expect(tx.jobRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-lock-1' },
      data: { status: 'MATCHED' },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'lead.provider_accepted_locked',
        entityId: 'lead-lock-1',
      }),
    })
    expect(state.lead.status).toBe('ACCEPTED')
  })

  it('replays idempotently after the lead is already ACCEPTED with assignment records', async () => {
    state.lead = makeLead({
      status: 'ACCEPTED',
      jobRequest: {
        ...makeLead().jobRequest,
        match: {
          id: 'match-existing-1',
          providerId: 'provider-lock-1',
          booking: { id: 'booking-existing-1', job: { id: 'job-existing-1' } },
        },
      },
    })

    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, {
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      matchId: 'match-existing-1',
      bookingId: 'booking-existing-1',
      jobId: 'job-existing-1',
      alreadyLocked: true,
      notificationPayload: null,
    })
    expect(tx.match.create).not.toHaveBeenCalled()
    expect(tx.job.create).not.toHaveBeenCalled()
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
    expect(tx.match.create).not.toHaveBeenCalled()
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
    expect(tx.match.create).not.toHaveBeenCalled()
  })

  it('blocks lock when the request is cancelled', async () => {
    state.lead = makeLead({ jobRequest: { ...makeLead().jobRequest, status: 'CANCELLED' } })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(tx.match.create).not.toHaveBeenCalled()
  })

  it('blocks lock when the lead is expired', async () => {
    state.lead = makeLead({ status: 'EXPIRED' })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'LEAD_EXPIRED' })
    expect(tx.match.create).not.toHaveBeenCalled()
  })

  it('blocks lock when the request is already matched to a different provider', async () => {
    state.lead = makeLead({
      jobRequest: {
        ...makeLead().jobRequest,
        match: { id: 'match-other', providerId: 'provider-other' },
      },
    })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'LEAD_ALREADY_LOCKED' })
    expect(tx.match.create).not.toHaveBeenCalled()
  })

  it('throws JOB_ASSIGNMENT_FAILED on concurrent race (updateMany returns count 0)', async () => {
    // Simulate a concurrent modification where the lead status changed between the read and update
    tx.lead.updateMany = vi.fn().mockResolvedValue({ count: 0 })

    await expect(
      lockAcceptedLeadAfterCreditInTransaction(tx as any, {
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).rejects.toMatchObject({ code: 'JOB_ASSIGNMENT_FAILED' })
  })

  it('keeps customer phone and address isolated in notificationPayload — not in root result', async () => {
    const result = await lockAcceptedLeadAfterCreditInTransaction(tx as any, {
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    const rootJson = JSON.stringify({ ...result, notificationPayload: undefined })
    expect(rootJson).not.toContain('+27220000000')
    expect(rootJson).not.toContain('Thandi Customer')
    expect(rootJson).not.toContain('1 Oak Avenue')
    // Customer details present in notificationPayload only
    expect(result.notificationPayload?.customerPhone).toBe('+27220000000')
    expect(result.notificationPayload?.customerName).toBe('Thandi Customer')
  })
})
