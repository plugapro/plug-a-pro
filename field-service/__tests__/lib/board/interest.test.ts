import { describe, expect, it, vi } from 'vitest'
import { expressBoardInterest } from '@/lib/board/interest'

const NOW = new Date('2026-07-21T12:00:00Z')

function deps(overrides: Record<string, any> = {}) {
  const callLog: string[] = []
  const tx = {
    $queryRaw: vi.fn(async (..._args: any[]) => {
      callLog.push('$queryRaw')
      return [{ id: 'jr1' }]
    }),
    jobRequest: {
      findFirst: vi.fn(async (..._args: any[]) => {
        callLog.push('jobRequest.findFirst')
        return { id: 'jr1', category: 'plumbing' }
      }),
    },
    lead: {
      count: vi.fn(async (..._args: any[]) => {
        callLog.push('lead.count')
        return 1
      }),
      findUnique: vi.fn().mockResolvedValue(null), // no prior lead for (jr1, p1)
      create: vi.fn().mockResolvedValue({ id: 'lead-new' }),
      update: vi.fn().mockResolvedValue({ id: 'lead-revived' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  return {
    now: () => NOW,
    // db.lead is the SAME object as tx.lead so that a compensating update run
    // via db.lead.update(...) (outside the row transaction, after the
    // transaction has already committed) is visible to assertions against
    // db._tx.lead.update as well as to the revive-after-failure retry test.
    db: { $transaction: vi.fn(async (fn: any) => fn(tx)), lead: tx.lead, _tx: tx },
    callLog,
    flagEnabled: vi.fn().mockResolvedValue(true),
    isProviderBoardEligible: vi.fn().mockResolvedValue(true), // active+verified+in-area+skill (Task 2 logic)
    validateInput: vi.fn().mockReturnValue(true),               // fee/arrival pre-write validation
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

  it('validateInput rejects the input → INVALID_INPUT before any transaction', async () => {
    const d = deps({ validateInput: vi.fn().mockReturnValue(false) })
    const badInput = { ...input, callOutFee: -50 }
    expect(await expressBoardInterest(d, badInput)).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(d.db.$transaction).not.toHaveBeenCalled()
    expect(d.validateInput).toHaveBeenCalledWith(badInput)
  })

  it('recordInterest throws → INTEREST_RECORD_FAILED, lead compensated to EXPIRED, no unhandled rejection', async () => {
    const d = deps({ recordInterest: vi.fn().mockRejectedValue(new Error('rate validation failed')) })
    const result = await expressBoardInterest(d, input)
    expect(result).toEqual({ ok: false, reason: 'INTEREST_RECORD_FAILED' })
    expect(d.db._tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-new' },
        data: expect.objectContaining({ status: 'EXPIRED', expiredAt: NOW }),
      }),
    )
    expect(d.triggerShortlist).not.toHaveBeenCalled()
  })

  it('retry after INTEREST_RECORD_FAILED revives the compensated EXPIRED lead instead of staying stuck', async () => {
    const d = deps({ recordInterest: vi.fn().mockRejectedValue(new Error('transient')) })
    const first = await expressBoardInterest(d, input)
    expect(first).toEqual({ ok: false, reason: 'INTEREST_RECORD_FAILED' })

    // Simulate the second attempt: prior lead now EXPIRED (compensated), recordInterest now succeeds.
    d.db._tx.lead.findUnique.mockResolvedValue({ id: 'lead-new', status: 'EXPIRED' })
    d.recordInterest = vi.fn().mockResolvedValue({ ok: true })
    const second = await expressBoardInterest(d, input)
    expect(second).toEqual({ ok: true, leadId: 'lead-new' })
    expect(d.db._tx.lead.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'lead-new' },
        data: expect.objectContaining({ status: 'VIEWED' }),
      }),
    )
  })

  it('locks the job row (FOR UPDATE) before counting open interests, inside the transaction', async () => {
    const d = deps()
    await expressBoardInterest(d, input)
    const lockIndex = d.callLog.indexOf('$queryRaw')
    const countIndex = d.callLog.indexOf('lead.count')
    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(countIndex).toBeGreaterThan(lockIndex)
  })
})
