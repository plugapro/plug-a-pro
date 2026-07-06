// SRE-03: inbound WhatsApp dead-letter re-drive.
//
// Pins the sweep contract: flag-off no-op, the selection window (unprocessed +
// failed + <60min + <3 attempts), the CAS claim that prevents double
// processing, and success/failure bookkeeping.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockIsEnabled, mockProcessInboundMessage } = vi.hoisted(() => ({
  mockDb: {
    inboundWhatsAppMessage: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  mockIsEnabled: vi.fn(),
  mockProcessInboundMessage: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/whatsapp-bot', () => ({ processInboundMessage: mockProcessInboundMessage }))

import {
  MAX_REPROCESS_ATTEMPTS,
  REDRIVE_WINDOW_MINUTES,
  buildRedriveWhere,
  runInboundWhatsappRedrive,
} from '@/lib/inbound-whatsapp-redrive'

function deadRow(overrides: Partial<{ id: string; reprocessAttempts: number }> = {}) {
  return {
    id: overrides.id ?? 'in_1',
    externalId: `wamid.${overrides.id ?? 'in_1'}`,
    phone: '27820000001',
    payload: { id: `wamid.${overrides.id ?? 'in_1'}`, from: '27820000001', type: 'text', text: { body: 'hi' } },
    reprocessAttempts: overrides.reprocessAttempts ?? 0,
    failureReason: 'db blip',
  }
}

describe('inbound WhatsApp redrive (SRE-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockDb.inboundWhatsAppMessage.findMany.mockResolvedValue([])
    mockDb.inboundWhatsAppMessage.updateMany.mockResolvedValue({ count: 1 })
    mockDb.inboundWhatsAppMessage.update.mockResolvedValue({})
    mockProcessInboundMessage.mockResolvedValue(undefined)
  })

  it('no-ops (with zero DB reads) when whatsapp.inbound.redrive is OFF', async () => {
    mockIsEnabled.mockResolvedValue(false)

    const summary = await runInboundWhatsappRedrive()

    expect(summary).toEqual({
      skipped: true,
      reason: 'flag_disabled',
      considered: 0,
      reprocessed: 0,
      failed: 0,
      skippedClaim: 0,
    })
    expect(mockDb.inboundWhatsAppMessage.findMany).not.toHaveBeenCalled()
    expect(mockProcessInboundMessage).not.toHaveBeenCalled()
  })

  it('selects only unprocessed+failed rows within the 60-minute window and under the attempt cap', () => {
    const now = new Date('2026-07-06T12:00:00.000Z')
    const where = buildRedriveWhere(now)

    expect(where.processedAt).toBeNull()
    expect(where.failureReason).toEqual({ not: null })
    expect(where.reprocessAttempts).toEqual({ lt: MAX_REPROCESS_ATTEMPTS })
    expect(MAX_REPROCESS_ATTEMPTS).toBe(3)
    // Window: firstSeenAt >= now - 60 minutes. Stale messages stay
    // dead-lettered — replaying them hours later would confuse customers.
    expect(REDRIVE_WINDOW_MINUTES).toBe(60)
    expect(where.firstSeenAt).toEqual({ gte: new Date('2026-07-06T11:00:00.000Z') })
  })

  it('queries with the selection criteria and reprocesses through the same bot entry point', async () => {
    const row = deadRow()
    mockDb.inboundWhatsAppMessage.findMany.mockResolvedValue([row])

    const summary = await runInboundWhatsappRedrive()

    const findArgs = mockDb.inboundWhatsAppMessage.findMany.mock.calls[0][0]
    expect(findArgs.where.processedAt).toBeNull()
    expect(findArgs.where.failureReason).toEqual({ not: null })
    expect(findArgs.where.reprocessAttempts).toEqual({ lt: 3 })

    // The stored webhook payload is replayed through processInboundMessage.
    expect(mockProcessInboundMessage).toHaveBeenCalledWith(row.payload)

    // Success clears the dead letter.
    expect(mockDb.inboundWhatsAppMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'in_1' },
      data: expect.objectContaining({ processedAt: expect.any(Date), failureReason: null }),
    }))
    expect(summary).toMatchObject({ skipped: false, considered: 1, reprocessed: 1, failed: 0 })
  })

  it('claims each row with a CAS increment on reprocessAttempts and skips rows already claimed elsewhere', async () => {
    const row = deadRow({ reprocessAttempts: 1 })
    mockDb.inboundWhatsAppMessage.findMany.mockResolvedValue([row])
    // Another (overlapping) run claimed it first.
    mockDb.inboundWhatsAppMessage.updateMany.mockResolvedValue({ count: 0 })

    const summary = await runInboundWhatsappRedrive()

    expect(mockDb.inboundWhatsAppMessage.updateMany).toHaveBeenCalledWith({
      where: { id: 'in_1', processedAt: null, reprocessAttempts: 1 },
      data: { reprocessAttempts: { increment: 1 } },
    })
    expect(mockProcessInboundMessage).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ skippedClaim: 1, reprocessed: 0, failed: 0 })
  })

  it('records a fresh failureReason (and keeps the row dead-lettered) when reprocessing fails again', async () => {
    const row = deadRow()
    mockDb.inboundWhatsAppMessage.findMany.mockResolvedValue([row])
    mockProcessInboundMessage.mockRejectedValue(new Error('still broken'))

    const summary = await runInboundWhatsappRedrive()

    expect(mockDb.inboundWhatsAppMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'in_1' },
      data: expect.objectContaining({ failureReason: 'still broken' }),
    }))
    // processedAt must NOT be set on failure.
    const successUpdates = mockDb.inboundWhatsAppMessage.update.mock.calls.filter(
      (c) => c[0].data.processedAt !== undefined,
    )
    expect(successUpdates).toHaveLength(0)
    expect(summary).toMatchObject({ reprocessed: 0, failed: 1 })
  })

  it('isolates failures per message: one broken payload never blocks the rest of the batch', async () => {
    mockDb.inboundWhatsAppMessage.findMany.mockResolvedValue([
      deadRow({ id: 'in_1' }),
      deadRow({ id: 'in_2' }),
    ])
    mockProcessInboundMessage
      .mockRejectedValueOnce(new Error('broken payload'))
      .mockResolvedValueOnce(undefined)

    const summary = await runInboundWhatsappRedrive()

    expect(mockProcessInboundMessage).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({ considered: 2, reprocessed: 1, failed: 1 })
  })
})
