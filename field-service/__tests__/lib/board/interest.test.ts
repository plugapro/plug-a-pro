import { describe, expect, it, vi } from 'vitest'
import { expressBoardInterest } from '@/lib/board/interest'

const NOW = new Date('2026-07-21T12:00:00Z')

function deps(overrides: Record<string, any> = {}) {
  const tx = {
    jobRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'jr1', category: 'plumbing' }) },
    lead: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue(null), // no prior lead for (jr1, p1)
      create: vi.fn().mockResolvedValue({ id: 'lead-new' }),
      update: vi.fn().mockResolvedValue({ id: 'lead-revived' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  return {
    now: () => NOW,
    db: { $transaction: vi.fn(async (fn: any) => fn(tx)), _tx: tx },
    flagEnabled: vi.fn().mockResolvedValue(true),
    isProviderBoardEligible: vi.fn().mockResolvedValue(true), // active+verified+in-area+skill (Task 2 logic)
    recordInterest: vi.fn().mockResolvedValue({ ok: true }),   // respondToProviderOpportunity wrapper
    triggerShortlist: vi.fn().mockResolvedValue(undefined),    // generate + notify customer
    ...overrides,
  } as any // TODO: fake deps for unit test
}

const input = {
  providerId: 'p1', jobRequestId: 'jr1',
  callOutFee: 350, estimatedArrivalAt: new Date('2026-07-21T15:00:00Z'),
}

describe('expressBoardInterest', () => {
  it('flag off → FLAG_OFF, zero DB work', async () => {
    const d = deps({ flagEnabled: vi.fn().mockResolvedValue(false) })
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'FLAG_OFF' })
    expect(d.db.$transaction).not.toHaveBeenCalled()
  })

  it('creates a BOARD-origin lead, records interest, triggers shortlist + audit', async () => {
    const d = deps()
    const result = await expressBoardInterest(d, input)
    expect(result).toEqual({ ok: true, leadId: 'lead-new' })
    expect(d.db._tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobRequestId: 'jr1', providerId: 'p1', origin: 'BOARD', status: 'VIEWED',
        }),
      }),
    )
    expect(d.recordInterest).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-new', callOutFee: 350 }),
    )
    expect(d.triggerShortlist).toHaveBeenCalledWith('jr1')
    expect(d.db._tx.auditLog.create).toHaveBeenCalled()
  })

  it('shortlist full at 3 → SHORTLIST_FULL, no lead created', async () => {
    const d = deps()
    d.db._tx.lead.count.mockResolvedValue(3)
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'SHORTLIST_FULL' })
    expect(d.db._tx.lead.create).not.toHaveBeenCalled()
  })

  it('job no longer eligible → JOB_GONE', async () => {
    const d = deps()
    d.db._tx.jobRequest.findFirst.mockResolvedValue(null)
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'JOB_GONE' })
  })

  it('revives a terminal prior lead for the same provider instead of creating (unique constraint)', async () => {
    const d = deps()
    d.db._tx.lead.findUnique.mockResolvedValue({ id: 'old-lead', status: 'EXPIRED' })
    const result = await expressBoardInterest(d, input)
    expect(result).toEqual({ ok: true, leadId: 'old-lead' })
    expect(d.db._tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-lead' },
        data: expect.objectContaining({ origin: 'BOARD', status: 'VIEWED' }),
      }),
    )
    expect(d.db._tx.lead.create).not.toHaveBeenCalled()
  })

  it('prior lead already in an open state → ALREADY_INTERESTED', async () => {
    const d = deps()
    d.db._tx.lead.findUnique.mockResolvedValue({ id: 'old-lead', status: 'INTERESTED' })
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'ALREADY_INTERESTED' })
  })

  it('ineligible provider → NOT_ELIGIBLE_PROVIDER before any transaction', async () => {
    const d = deps({ isProviderBoardEligible: vi.fn().mockResolvedValue(false) })
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'NOT_ELIGIBLE_PROVIDER' })
    expect(d.db.$transaction).not.toHaveBeenCalled()
  })
})
