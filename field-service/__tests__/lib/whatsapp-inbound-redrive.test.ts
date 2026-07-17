import { describe, it, expect, vi } from 'vitest'
import {
  buildRedriveCandidateWhere,
  redriveInboundWhatsApp,
  REDRIVE_WINDOW_HOURS,
} from '@/lib/whatsapp-inbound-redrive'

const NOW = new Date('2026-07-11T12:00:00.000Z')

describe('buildRedriveCandidateWhere', () => {
  it('selects only failed, unprocessed rows within the retry window', () => {
    const where = buildRedriveCandidateWhere(NOW)
    expect(where.processedAt).toBeNull()
    expect(where.failureReason).toEqual({ not: null })
    const cutoff = (where.firstSeenAt as { gte: Date }).gte
    expect(cutoff.getTime()).toBe(NOW.getTime() - REDRIVE_WINDOW_HOURS * 3600_000)
  })
})

function fakeDb(rows: Array<{ externalId: string; payload: unknown }>) {
  const updates: Array<{ externalId: string; data: Record<string, unknown> }> = []
  return {
    updates,
    db: {
      inboundWhatsAppMessage: {
        findMany: vi.fn().mockResolvedValue(rows),
        update: vi.fn(async ({ where, data }: { where: { externalId: string }; data: Record<string, unknown> }) => {
          updates.push({ externalId: where.externalId, data })
          return {}
        }),
      },
    } as never,
  }
}

describe('redriveInboundWhatsApp', () => {
  it('report-only when flag disabled: counts candidates, no processing, no writes', async () => {
    const { db, updates } = fakeDb([{ externalId: 'w1', payload: {} }, { externalId: 'w2', payload: {} }])
    const processMessage = vi.fn()

    const summary = await redriveInboundWhatsApp({ db, processMessage, now: NOW, flagEnabled: false })

    expect(summary).toEqual({ mode: 'report_only', candidates: 2, reprocessed: 0, stillFailing: 0 })
    expect(processMessage).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('active + success: reprocesses, stamps processedAt and clears failureReason', async () => {
    const { db, updates } = fakeDb([{ externalId: 'w1', payload: { from: '27820000000' } }])
    const processMessage = vi.fn().mockResolvedValue(undefined)

    const summary = await redriveInboundWhatsApp({ db, processMessage, now: NOW, flagEnabled: true })

    expect(summary).toMatchObject({ mode: 'active', candidates: 1, reprocessed: 1, stillFailing: 0 })
    expect(processMessage).toHaveBeenCalledOnce()
    expect(updates).toEqual([
      { externalId: 'w1', data: { processedAt: NOW, failureReason: null } },
    ])
  })

  it('active + failure: records failureReason, does NOT stamp processedAt', async () => {
    const { db, updates } = fakeDb([{ externalId: 'w1', payload: {} }])
    const processMessage = vi.fn().mockRejectedValue(new Error('still broken'))

    const summary = await redriveInboundWhatsApp({ db, processMessage, now: NOW, flagEnabled: true })

    expect(summary).toMatchObject({ mode: 'active', candidates: 1, reprocessed: 0, stillFailing: 1 })
    expect(updates).toHaveLength(1)
    expect(updates[0].data).toHaveProperty('failureReason', 'still broken')
    expect(updates[0].data).not.toHaveProperty('processedAt')
  })

  it('mixed batch: one succeeds, one fails', async () => {
    const { db } = fakeDb([{ externalId: 'ok', payload: {} }, { externalId: 'bad', payload: {} }])
    const processMessage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))

    const summary = await redriveInboundWhatsApp({ db, processMessage, now: NOW, flagEnabled: true })

    expect(summary).toMatchObject({ candidates: 2, reprocessed: 1, stillFailing: 1 })
  })
})
