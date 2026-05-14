import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { sendAcceptedLockConfirmations } from '../../lib/provider-accepted-lock'

const { mockDb, mockSendTemplate, mockSendText } = vi.hoisted(() => ({
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
    inboundWhatsAppMessage: {
      findFirst: vi.fn(),
    },
  },
  mockSendTemplate: vi.fn(),
  mockSendText: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/whatsapp', () => ({ sendTemplate: mockSendTemplate, sendText: mockSendText }))

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
    mockDb.inboundWhatsAppMessage.findFirst.mockResolvedValue({ id: 'inbound-recent-1' })
    mockSendTemplate.mockResolvedValue('wamid-confirmation')
    mockSendText.mockResolvedValue('wamid-text-confirmation')
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
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27220000000',
      template: 'mvp1_accepted_lock_customer_confirmation',
      components: [],
      metadata: expect.objectContaining({
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
        jobRequestId: 'request-lock-1',
        recipientRole: 'customer',
        idempotencyKey: 'accepted_lock_confirmation:customer:lead-lock-1:provider-lock-1',
        source: 'accepted_lock_confirmation',
        traceId: 'trace-lock-1',
      }),
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

    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27110000000',
      template: 'mvp1_accepted_lock_provider_confirmation',
      components: [],
      metadata: expect.objectContaining({
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
        jobRequestId: 'request-lock-1',
        recipientRole: 'provider',
        idempotencyKey: 'accepted_lock_confirmation:provider:lead-lock-1:provider-lock-1',
        source: 'accepted_lock_confirmation',
      }),
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
    expect(mockSendTemplate).not.toHaveBeenCalled()
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
    expect(mockSendTemplate).not.toHaveBeenCalled()
  })

  it('records notification failure without changing accepted lock state', async () => {
    mockSendTemplate
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

  it('falls back to text when accepted-lock templates are not approved', async () => {
    mockSendTemplate
      .mockRejectedValueOnce(new Error('[TEMPLATE_NOT_APPROVED] Template "mvp1_accepted_lock_customer_confirmation" is not approved. code=132001'))
      .mockResolvedValueOnce('wamid-provider-confirmation')

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
      text: expect.stringContaining('Your request is confirmed'),
      templateName: 'mvp1_accepted_lock_customer_confirmation:fallback_text',
      recordMessageEvent: false,
      metadata: expect.objectContaining({
        leadId: 'lead-lock-1',
        providerId: 'provider-lock-1',
        recipientRole: 'customer',
        fallbackReason: 'TEMPLATE_NOT_APPROVED',
      }),
    }))
    expect(mockDb.inboundWhatsAppMessage.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        phone: { in: expect.arrayContaining(['+27220000000', '27220000000']) },
      }),
      select: { id: true },
    })
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'QUEUED' },
      data: expect.objectContaining({
        status: 'SENT',
        externalId: 'wamid-text-confirmation',
        failureReason: null,
      }),
    })
  })

  it('does not send fallback text when the WhatsApp service window is closed', async () => {
    mockDb.inboundWhatsAppMessage.findFirst.mockResolvedValueOnce(null)
    mockSendTemplate
      .mockRejectedValueOnce(new Error('[TEMPLATE_NOT_APPROVED] Template "mvp1_accepted_lock_customer_confirmation" is not approved. code=132001'))
      .mockResolvedValueOnce('wamid-provider-confirmation')

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: {
        sent: false,
        failureReason: expect.stringContaining('fallback text skipped: NO_ACTIVE_WHATSAPP_SERVICE_WINDOW'),
      },
      provider: { sent: true },
    })
    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'QUEUED' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('NO_ACTIVE_WHATSAPP_SERVICE_WINDOW'),
      }),
    })
  })

  it('records the fallback text failure if template and fallback both fail', async () => {
    mockSendTemplate
      .mockRejectedValueOnce(new Error('[TEMPLATE_NOT_APPROVED] Template "mvp1_accepted_lock_customer_confirmation" is not approved. code=132001'))
      .mockResolvedValueOnce('wamid-provider-confirmation')
    mockSendText.mockRejectedValueOnce(new Error('WhatsApp send failed: outside customer service window'))

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: {
        sent: false,
        failureReason: expect.stringContaining('fallback text failed: WhatsApp send failed'),
      },
      provider: { sent: true },
    })
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'QUEUED' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('fallback text failed: WhatsApp send failed'),
      }),
    })
  })

  it('retries only the failed recipient on partial failure replay without re-sending to succeeded recipient', async () => {
    // Simulate state after a first call where provider send succeeded but customer failed.
    // hasAcceptedLockConfirmationSent returns true only for the provider idempotency key.
    mockDb.messageEvent.findFirst.mockImplementation(async (args: any) => {
      const key = args?.where?.idempotencyKey
      if (key === 'accepted_lock_confirmation:provider:lead-lock-1:provider-lock-1') {
        return { id: 'message-provider-sent' }
      }
      return null
    })

    const result = await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    expect(result).toMatchObject({
      ok: true,
      customer: { sent: true },
      provider: { sent: false, skipped: 'duplicate' },
    })
    expect(mockSendTemplate).toHaveBeenCalledTimes(1)
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27220000000',
      template: 'mvp1_accepted_lock_customer_confirmation',
    }))
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
    expect(mockSendTemplate).not.toHaveBeenCalled()
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
    expect(mockSendTemplate).not.toHaveBeenCalled()
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
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })

  it('keeps confirmation message payloads free of customer direct details and job-management copy', async () => {
    await sendAcceptedLockConfirmations({
      leadId: 'lead-lock-1',
      providerId: 'provider-lock-1',
    })

    const reservedBodies = (mockDb.messageEvent.create.mock.calls as any[][])
      .map((args) => args[0]?.data?.body ?? '')
      .join('\n')
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'mvp1_accepted_lock_customer_confirmation',
      components: [],
    }))
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'mvp1_accepted_lock_provider_confirmation',
      components: [],
    }))
    expect(reservedBodies).not.toContain('+27220000000')
    expect(reservedBodies).not.toContain('+27110000000')
    expect(reservedBodies).not.toContain('Gate')
    expect(reservedBodies).not.toContain('address')
    expect(reservedBodies).not.toContain('booking')
    expect(reservedBodies).not.toContain('job management')
  })
})
