import { describe, expect, it, vi } from 'vitest'

import {
  ACTIVE_MISSING_KYC_STATUSES,
  fetchKycActivity,
  fetchKycSnapshot,
  KYC_FUNNEL_STAGES,
} from '@/lib/admin/kyc-funnel-aggregate'

const NOW = new Date('2026-06-28T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

type SnapshotDb = NonNullable<Parameters<typeof fetchKycSnapshot>[0]['db']>

type Mocks = {
  providerGroupBy: ReturnType<typeof vi.fn>
  pivCount: ReturnType<typeof vi.fn>
  pivGroupBy: ReturnType<typeof vi.fn>
  db: SnapshotDb
}

function mockDb(overrides: {
  groupByCounts?: Array<{ kycStatus: string; _count: { _all: number } }>
  newStarts?: number
  decisionCounts?: Array<{ status: string; _count: { _all: number } }>
}): Mocks {
  const providerGroupBy = vi.fn().mockResolvedValue(overrides.groupByCounts ?? [])
  const pivCount = vi.fn().mockResolvedValue(overrides.newStarts ?? 0)
  const pivGroupBy = vi.fn().mockResolvedValue(overrides.decisionCounts ?? [])
  return {
    providerGroupBy,
    pivCount,
    pivGroupBy,
    db: {
      provider: { groupBy: providerGroupBy },
      providerIdentityVerification: { count: pivCount, groupBy: pivGroupBy },
    } as unknown as SnapshotDb,
  }
}

describe('KYC_FUNNEL_STAGES', () => {
  it('lists the six KycStatus values in funnel order', () => {
    expect(KYC_FUNNEL_STAGES).toEqual([
      'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED',
    ])
  })

  it('classifies any non-VERIFIED kycStatus as missing-KYC for active providers', () => {
    expect(ACTIVE_MISSING_KYC_STATUSES).toContain('NOT_STARTED')
    expect(ACTIVE_MISSING_KYC_STATUSES).toContain('IN_PROGRESS')
    expect(ACTIVE_MISSING_KYC_STATUSES).toContain('SUBMITTED')
    expect(ACTIVE_MISSING_KYC_STATUSES).toContain('REJECTED')
    expect(ACTIVE_MISSING_KYC_STATUSES).toContain('EXPIRED')
    expect(ACTIVE_MISSING_KYC_STATUSES).not.toContain('VERIFIED')
  })
})

describe('fetchKycSnapshot', () => {
  it('returns counts for every stage even when the DB row is absent', async () => {
    const m = mockDb({
      groupByCounts: [
        { kycStatus: 'NOT_STARTED', _count: { _all: 50 } },
        { kycStatus: 'VERIFIED', _count: { _all: 5 } },
      ],
    })
    const snapshot = await fetchKycSnapshot({ db: m.db, status: 'ACTIVE' })
    expect(snapshot).toEqual({
      notStarted: 50,
      inProgress: 0,
      submitted: 0,
      verified: 5,
      rejected: 0,
      expired: 0,
      total: 55,
      activeMissingKyc: 50,
    })
  })

  it('sums every kycStatus into activeMissingKyc except VERIFIED', async () => {
    const m = mockDb({
      groupByCounts: [
        { kycStatus: 'NOT_STARTED', _count: { _all: 20 } },
        { kycStatus: 'IN_PROGRESS', _count: { _all: 10 } },
        { kycStatus: 'SUBMITTED', _count: { _all: 5 } },
        { kycStatus: 'VERIFIED', _count: { _all: 30 } },
        { kycStatus: 'REJECTED', _count: { _all: 3 } },
        { kycStatus: 'EXPIRED', _count: { _all: 2 } },
      ],
    })
    const snapshot = await fetchKycSnapshot({ db: m.db, status: 'ACTIVE' })
    expect(snapshot.total).toBe(70)
    expect(snapshot.activeMissingKyc).toBe(40)
  })

  it('passes the requested provider status to the DB query', async () => {
    const m = mockDb({})
    await fetchKycSnapshot({ db: m.db, status: 'APPLICATION_PENDING' })
    expect(m.providerGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'APPLICATION_PENDING' }),
    }))
  })

  it('omits the status filter when status arg is undefined', async () => {
    const m = mockDb({})
    await fetchKycSnapshot({ db: m.db })
    const arg = m.providerGroupBy.mock.calls[0][0] as { where: Record<string, unknown> }
    expect('status' in arg.where).toBe(false)
  })
})

describe('fetchKycActivity', () => {
  const range = { from: new Date(NOW.getTime() - 7 * DAY_MS), to: NOW }

  it('returns newStarts + decision counts bucketed by status', async () => {
    const m = mockDb({
      newStarts: 12,
      decisionCounts: [
        { status: 'PASSED', _count: { _all: 4 } },
        { status: 'FAILED', _count: { _all: 2 } },
        { status: 'EXPIRED', _count: { _all: 1 } },
      ],
    })
    const activity = await fetchKycActivity({ db: m.db, ...range })
    expect(activity).toEqual({
      newStarts: 12,
      verifiedInWindow: 4,
      rejectedInWindow: 2,
      expiredInWindow: 1,
    })
  })

  it('zero-fills missing decision statuses', async () => {
    const m = mockDb({ newStarts: 0, decisionCounts: [] })
    const activity = await fetchKycActivity({ db: m.db, ...range })
    expect(activity).toEqual({
      newStarts: 0, verifiedInWindow: 0, rejectedInWindow: 0, expiredInWindow: 0,
    })
  })

  it('filters newStarts by createdAt in the range', async () => {
    const m = mockDb({})
    await fetchKycActivity({ db: m.db, ...range })
    expect(m.pivCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        createdAt: { gte: range.from, lt: range.to },
      }),
    }))
  })

  it('filters terminal decisions by decisionAt in the range and constrains to the terminal status set', async () => {
    const m = mockDb({})
    await fetchKycActivity({ db: m.db, ...range })
    const arg = m.pivGroupBy.mock.calls[0][0] as {
      where: { decisionAt: { gte: Date; lt: Date }; status: { in: string[] } }
    }
    expect(arg.where.decisionAt).toEqual({ gte: range.from, lt: range.to })
    expect(arg.where.status.in).toEqual(expect.arrayContaining(['PASSED', 'FAILED', 'EXPIRED']))
  })
})
