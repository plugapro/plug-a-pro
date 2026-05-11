import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { sendAcceptedLockConfirmations } from '../../lib/provider-accepted-lock'

const { mockDb, mockSendText } = vi.hoisted(() => ({
  mockDb: {
    lead: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    messageEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockSendText: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/whatsapp', () => ({ sendText: mockSendText }))

function makeLockedLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-lock-1',
    providerId: 'provider-lock-1',
    status: 'ACCEPTED_LOCKED',
    jobRequestId: 'request-lock-1',
    provider: { phone: '+27110000000' },
    jobRequest: {
      id: 'request-lock-1',
      status: 'ACCEPTED_LOCKED',
      selectedProviderId: 'provider-lock-1',
      selectedLeadInviteId: 'lead-lock-1',
      customer: { phone: '+27220000000' },
    },
    ...overrides,
  }
}

describe('accepted lock confirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.lead.findUnique.mockResolvedValue(makeLockedLead())
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.messageEvent.create.mockImplementation(async () => ({ id: `message-${mockDb.messageEvent.create.mock.calls.length}` }))
    mockDb.messageEvent.updateMany.mockResolvedValue({ count: 1 })
    mockSendText.mockResolvedValue('wamid-confirmation')
  })

  it('sends the customer confirmation after accepted lock', async () => {
    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
      traceId: 'trace-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: true },
      provider: { sent: true },
    })
    expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27220000000',
      templateName: 'mvp1_accepted_lock_customer_confirmation',
      text: expect.stringContaining('Your request is now confirmed at MVP1 level'),
      metadata: expect.objectContaining({
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
        jobRequestId: 'request-lock-1',
        recipientRole: 'customer',
        idempotencyKey: 'accepted_lock_confirmation:customer:lead-lock-1:provider-lock-1',
        source: 'accepted_lock_confirmation',
        traceId: 'trace-lock-1',
      }),
      recordMessageEvent: false,
    }))
    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateName: 'mvp1_accepted_lock_customer_confirmation',
        status: 'QUEUED',
        idempotencyKey: 'accepted_lock_confirmation:customer:lead-lock-1:provider-lock-1',
        metadata: expect.objectContaining({
          idempotencyKey: 'accepted_lock_confirmation:customer:lead-lock-1:provider-lock-1',
        }),
      }),
      select: { id: true },
    })
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'QUEUED' },
      data: expect.objectContaining({
        status: 'SENT',
        externalId: 'wamid-confirmation',
        failureReason: null,
      }),
    })
  })

  it('sends the provider confirmation after accepted lock', async () => {
    await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27110000000',
      templateName: 'mvp1_accepted_lock_provider_confirmation',
      text: expect.stringContaining('Your credit has been applied'),
      metadata: expect.objectContaining({
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
        jobRequestId: 'request-lock-1',
        recipientRole: 'provider',
        idempotencyKey: 'accepted_lock_confirmation:provider:lead-lock-1:provider-lock-1',
        source: 'accepted_lock_confirmation',
      }),
      recordMessageEvent: false,
    }))
  })

  it('does not send duplicate confirmations on retry', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'message-existing-1' })

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: false, skipped: 'duplicate' },
      provider: { sent: false, skipped: 'duplicate' },
    })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('treats an in-flight confirmation reservation as duplicate to prevent retry spam', async () => {
    mockDb.messageEvent.findFirst.mockResolvedValue(null)
    mockDb.messageEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`idempotencyKey`)',
        { code: 'P2002', clientVersion: 'test' },
      ),
    )

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: false, skipped: 'duplicate' },
      provider: { sent: false, skipped: 'duplicate' },
    })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('records notification failure without changing accepted lock state', async () => {
    mockSendText
      .mockRejectedValueOnce(new Error('whatsapp unavailable'))
      .mockResolvedValueOnce('wamid-provider-confirmation')

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: false, failureReason: 'whatsapp unavailable' },
      provider: { sent: true },
    })
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'QUEUED' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: 'whatsapp unavailable',
      }),
    })
    expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
  })

  it('treats reservation database failure as non-destructive notification failure', async () => {
    mockDb.messageEvent.create.mockRejectedValueOnce(new Error('db unavailable'))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: false, failureReason: 'db unavailable' },
      provider: { sent: true },
    })
    expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
  })

  it('notify wrapper returns false instead of throwing when confirmation infrastructure fails', async () => {
    const { notifyAcceptedLeadLocked } = await import('../../lib/provider-accepted-lock')
    mockDb.lead.findUnique.mockRejectedValueOnce(new Error('read failed'))

    await expect(
      notifyAcceptedLeadLocked({
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
      }),
    ).resolves.toBe(false)
  })

  it('records missing customer WhatsApp as retryable notification failure', async () => {
    mockDb.lead.findUnique.mockResolvedValue(makeLockedLead({
      jobRequest: {
        ...makeLockedLead().jobRequest,
        customer: { phone: null },
      },
    }))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: false, failureReason: 'WHATSAPP_PHONE_MISSING' },
      provider: { sent: true },
    })
    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: 'missing:customer:lead-lock-1',
        status: 'FAILED',
        failureReason: 'WHATSAPP_PHONE_MISSING',
      }),
    })
  })

  it('records missing provider WhatsApp as retryable notification failure', async () => {
    mockDb.lead.findUnique.mockResolvedValue(makeLockedLead({
      provider: { phone: '' },
    }))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: true },
      provider: { sent: false, failureReason: 'WHATSAPP_PHONE_MISSING' },
    })
    expect(mockDb.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: 'missing:provider:lead-lock-1',
        status: 'FAILED',
        failureReason: 'WHATSAPP_PHONE_MISSING',
      }),
    })
  })

  it('blocks confirmation when the lead is not accepted locked', async () => {
    mockDb.lead.findUnique.mockResolvedValue(makeLockedLead({ status: 'CREDIT_APPLIED' }))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toEqual({ ok: false, reason: 'LEAD_NOT_LOCKED' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('blocks confirmation when the request is not accepted locked', async () => {
    mockDb.lead.findUnique.mockResolvedValue(makeLockedLead({
      jobRequest: {
        ...makeLockedLead().jobRequest,
        status: 'PROVIDER_CONFIRMATION_PENDING',
      },
    }))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toEqual({ ok: false, reason: 'REQUEST_NOT_LOCKED' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('does not send confirmations before credit is applied and accepted lock completes', async () => {
    mockDb.lead.findUnique.mockResolvedValue(makeLockedLead({
      status: 'PROVIDER_ACCEPTED',
      jobRequest: {
        ...makeLockedLead().jobRequest,
        status: 'PROVIDER_CONFIRMATION_PENDING',
      },
    }))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toEqual({ ok: false, reason: 'LEAD_NOT_LOCKED' })
    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })

  it('keeps confirmation message payloads free of customer direct details and job-management copy', async () => {
    await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    const sentTexts = mockSendText.mock.calls.map(([payload]) => payload.text).join('\n')
    expect(sentTexts).not.toContain('+27220000000')
    expect(sentTexts).not.toContain('+27110000000')
    expect(sentTexts).not.toContain('Gate')
    expect(sentTexts).not.toContain('address')
    expect(sentTexts).not.toContain('booking')
    expect(sentTexts).not.toContain('job management')
  })
})
