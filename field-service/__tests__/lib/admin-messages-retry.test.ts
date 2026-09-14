// AD-01: admin message Retry must be real.
//
// The old retry flipped the FAILED row to QUEUED (clearing failureReason) but
// nothing consumes QUEUED — a silent no-op that hid failures. These tests pin
// the new contract:
//   - Retry creates a NEW attempt row (metadata.retryOfId) and sends inline.
//   - The original FAILED row is never mutated (history preserved).
//   - The attempt row ends SENT or FAILED — never dangling QUEUED.
//   - Broadcast sends inline with per-recipient error isolation.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockSendTemplate, mockSendText } = vi.hoisted(() => ({
  mockDb: {
    messageEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
  mockSendTemplate: vi.fn(),
  mockSendText: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/crud-action', () => {
  class CrudActionError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'CrudActionError'
    }
  }
  // Passthrough: validates with the provided schema and runs the mutation with
  // the db mock standing in for the transaction client. Auth/roles/flags are
  // exercised by the real crudAction tests.
  const crudAction = vi.fn(async (opts: {
    schema?: { parse: (input: unknown) => unknown }
    input?: unknown
    run: (input: unknown, tx: unknown) => Promise<unknown>
  }) => {
    const input = opts.schema ? opts.schema.parse(opts.input) : opts.input
    const data = await opts.run(input, mockDb)
    return { ok: true as const, data }
  })
  return { crudAction, CrudActionError }
})

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: mockSendTemplate,
  sendText: mockSendText,
}))

vi.mock('@/lib/messaging-templates', () => ({
  TEMPLATES: {
    booking_cancelled: { name: 'booking_cancelled', language: 'en_ZA' },
    customer_match_found: { name: 'customer_match_found', language: 'en_ZA' },
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { retryMessageAction, retryMessageFromFormAction, queueBroadcastAction } from '@/app/(admin)/admin/messages/actions'

const FAILED_TEMPLATE_MESSAGE = {
  id: 'msg_failed_1',
  status: 'FAILED',
  channel: 'WHATSAPP',
  to: '+27820000001',
  templateName: 'booking_cancelled',
  body: null,
  metadata: { bodyComponents: [{ type: 'body', parameters: [{ type: 'text', text: 'Alice' }] }] },
  customerId: 'cust_1',
  bookingId: 'booking_1',
  providerId: null,
  leadId: null,
  isTestEvent: false,
  cohortName: null,
  failureReason: 'boom',
}

describe('retryMessageAction (AD-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.messageEvent.findUnique.mockResolvedValue(FAILED_TEMPLATE_MESSAGE)
    mockDb.messageEvent.create.mockResolvedValue({
      id: 'msg_retry_1',
      to: FAILED_TEMPLATE_MESSAGE.to,
      templateName: FAILED_TEMPLATE_MESSAGE.templateName,
      body: FAILED_TEMPLATE_MESSAGE.body,
      metadata: { ...FAILED_TEMPLATE_MESSAGE.metadata, retryOfId: 'msg_failed_1', adminRetry: true },
    })
    mockDb.messageEvent.updateMany.mockResolvedValue({ count: 1 })
    mockSendTemplate.mockResolvedValue('wamid.retry')
    mockSendText.mockResolvedValue('wamid.retry-text')
  })

  it('creates a NEW attempt row linked via metadata.retryOfId and never mutates the FAILED original', async () => {
    const result = await retryMessageAction({ messageId: 'msg_failed_1' })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: 'msg_retry_1', retryOfId: 'msg_failed_1' })

    // New attempt row preserves recipient/template/relations and links back.
    expect(mockDb.messageEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        to: '+27820000001',
        templateName: 'booking_cancelled',
        status: 'QUEUED',
        customerId: 'cust_1',
        bookingId: 'booking_1',
        metadata: expect.objectContaining({ retryOfId: 'msg_failed_1', adminRetry: true }),
      }),
    }))

    // History preserved: no update() against the original row, and every
    // updateMany targets the NEW attempt row.
    expect(mockDb.messageEvent.update).not.toHaveBeenCalled()
    for (const call of mockDb.messageEvent.updateMany.mock.calls) {
      expect(call[0].where.id).toBe('msg_retry_1')
    }
  })

  it('re-sends inline via sendTemplate with the recorded bodyComponents and marks the attempt SENT', async () => {
    const result = await retryMessageAction({ messageId: 'msg_failed_1' })

    expect(mockSendTemplate).toHaveBeenCalledWith({
      to: '+27820000001',
      template: 'booking_cancelled',
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Alice' }] }],
    })
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg_retry_1', status: 'QUEUED' },
      data: expect.objectContaining({ status: 'SENT', externalId: 'wamid.retry' }),
    }))
    expect(result.sent).toBe(true)
  })

  it('marks the attempt FAILED (honestly) when the re-send fails — never a dangling QUEUED row', async () => {
    mockSendTemplate.mockRejectedValue(new Error('Meta says no'))

    const result = await retryMessageAction({ messageId: 'msg_failed_1' })

    expect(result.sent).toBe(false)
    expect(result.failureReason).toContain('Meta says no')
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg_retry_1', status: 'QUEUED' },
      data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('Meta says no') }),
    }))
  })

  it('falls back to a free-form sendText (without double message-event logging) when the template is not registered', async () => {
    mockDb.messageEvent.findUnique.mockResolvedValue({
      ...FAILED_TEMPLATE_MESSAGE,
      templateName: 'freeform:text',
      body: 'Hello again',
      metadata: {},
    })
    mockDb.messageEvent.create.mockResolvedValue({
      id: 'msg_retry_2',
      to: FAILED_TEMPLATE_MESSAGE.to,
      templateName: 'freeform:text',
      body: 'Hello again',
      metadata: { retryOfId: 'msg_failed_1', adminRetry: true },
    })

    await retryMessageAction({ messageId: 'msg_failed_1' })

    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27820000001',
      text: 'Hello again',
      recordMessageEvent: false,
    }))
  })

  it('rejects retry of a non-FAILED message', async () => {
    mockDb.messageEvent.findUnique.mockResolvedValue({ ...FAILED_TEMPLATE_MESSAGE, status: 'SENT' })
    const formData = new FormData()
    formData.set('messageId', 'msg_failed_1')

    const result = await retryMessageFromFormAction(formData)

    expect(result.ok).toBe(false)
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
    expect(mockSendTemplate).not.toHaveBeenCalled()
  })

  it('rejects retry of a non-WhatsApp message', async () => {
    mockDb.messageEvent.findUnique.mockResolvedValue({ ...FAILED_TEMPLATE_MESSAGE, channel: 'EMAIL' })
    const formData = new FormData()
    formData.set('messageId', 'msg_failed_1')

    const result = await retryMessageFromFormAction(formData)

    expect(result.ok).toBe(false)
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
  })
})

describe('queueBroadcastAction (AD-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.customer.findMany.mockResolvedValue([
      { id: 'cust_1', phone: '+27820000001' },
      { id: 'cust_2', phone: '+27820000002' },
    ])
    let n = 0
    mockDb.messageEvent.create.mockImplementation(async ({ data }: { data: { to: string; templateName: string; metadata: unknown } }) => ({
      id: `evt_${++n}`,
      to: data.to,
      templateName: data.templateName,
      body: null,
      metadata: data.metadata,
    }))
    mockDb.messageEvent.updateMany.mockResolvedValue({ count: 1 })
    mockSendTemplate.mockResolvedValue('wamid.broadcast')
  })

  it('sends inline for every queued recipient and reports counts', async () => {
    const result = await queueBroadcastAction({
      audienceType: 'active_customers',
      templateKey: 'customer_match_found',
      bodyParams: ['Alice'],
    })

    expect(mockSendTemplate).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, data: { queued: 2, sent: 2, failed: 0 } })
    // No row is left dangling QUEUED: each got a SENT transition.
    const sentUpdates = mockDb.messageEvent.updateMany.mock.calls.filter((c) => c[0].data.status === 'SENT')
    expect(sentUpdates).toHaveLength(2)
  })

  it('isolates per-recipient failures: one bad number never aborts the batch', async () => {
    mockSendTemplate
      .mockRejectedValueOnce(new Error('recipient blocked'))
      .mockResolvedValueOnce('wamid.ok')

    const result = await queueBroadcastAction({
      audienceType: 'active_customers',
      templateKey: 'customer_match_found',
      bodyParams: [],
    })

    expect(result).toMatchObject({ ok: true, data: { queued: 2, sent: 1, failed: 1 } })
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'evt_1', status: 'QUEUED' },
      data: expect.objectContaining({ status: 'FAILED', failureReason: expect.stringContaining('recipient blocked') }),
    }))
    expect(mockDb.messageEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'evt_2', status: 'QUEUED' },
      data: expect.objectContaining({ status: 'SENT' }),
    }))
  })

  it('rejects an unknown template before queuing anything', async () => {
    const result = await queueBroadcastAction({
      audienceType: 'active_customers',
      templateKey: 'not_a_template',
      bodyParams: [],
    })

    expect(result.ok).toBe(false)
    expect(mockDb.messageEvent.create).not.toHaveBeenCalled()
    expect(mockSendTemplate).not.toHaveBeenCalled()
  })
})
