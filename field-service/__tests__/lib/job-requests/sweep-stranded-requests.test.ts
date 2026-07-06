import { beforeEach, describe, expect, it, vi } from 'vitest'

// CJ-08: requests stranded in PENDING_VALIDATION / SHORTLIST_READY /
// PROVIDER_CONFIRMATION_PENDING must expire after their natural deadlines and
// send the EXISTING expiry notification.

const { mockDb, mockNotifyExpiredJobParties } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockNotifyExpiredJobParties: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
// Constant-only import: keep the heavy customer-shortlists module out of the graph.
vi.mock('@/lib/customer-shortlists', () => ({
  PROVIDER_CONFIRMATION_WINDOW_MS: 24 * 60 * 60 * 1000,
}))
vi.mock('@/lib/matching/customer-recontact', () => ({
  notifyExpiredJobParties: mockNotifyExpiredJobParties,
}))

import { sweepStrandedJobRequests, SHORTLIST_SELECTION_WINDOW_MS } from '@/lib/job-requests/sweep-stranded-requests'
import { expireOpenJobRequest } from '@/lib/job-requests/expire-job-request'

const NOW = new Date('2026-07-06T12:00:00Z')

describe('sweepStrandedJobRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    // expireOpenJobRequest runs inside db.$transaction — execute the callback
    // against the same mockDb (findUnique/updateMany are wired per test).
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb))
    mockDb.jobRequest.updateMany.mockResolvedValue({ count: 1 })
    mockNotifyExpiredJobParties.mockResolvedValue({ customerNotified: true, providerNotified: false })
  })

  it('selects exactly the three stranded statuses with their natural deadlines', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([])

    await sweepStrandedJobRequests({ now: NOW })

    const where = mockDb.jobRequest.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { status: 'PENDING_VALIDATION', expiresAt: { not: null, lte: NOW } },
      {
        status: { in: ['SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'] },
        OR: [
          { expiresAt: { not: null, lte: NOW } },
          { expiresAt: null, updatedAt: { lte: new Date(NOW.getTime() - SHORTLIST_SELECTION_WINDOW_MS) } },
        ],
      },
    ])
  })

  it('expires each stranded request with a status-scoped guard and notifies the customer', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([
      { id: 'jr-pv', status: 'PENDING_VALIDATION' },
      { id: 'jr-sr', status: 'SHORTLIST_READY' },
      { id: 'jr-pcp', status: 'PROVIDER_CONFIRMATION_PENDING' },
    ])
    mockDb.jobRequest.findUnique
      .mockResolvedValueOnce({ id: 'jr-pv', status: 'PENDING_VALIDATION' })
      .mockResolvedValueOnce({ id: 'jr-sr', status: 'SHORTLIST_READY' })
      .mockResolvedValueOnce({ id: 'jr-pcp', status: 'PROVIDER_CONFIRMATION_PENDING' })

    const result = await sweepStrandedJobRequests({ now: NOW })

    expect(result.expired).toBe(3)
    expect(result.notified).toBe(3)
    expect(result.byStatus).toEqual({
      PENDING_VALIDATION: 1,
      SHORTLIST_READY: 1,
      PROVIDER_CONFIRMATION_PENDING: 1,
    })
    // Each expiry used a CAS restricted to the request's own status.
    expect(mockDb.jobRequest.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'jr-pv', status: { in: ['PENDING_VALIDATION'] } },
      data: { status: 'EXPIRED' },
    })
    expect(mockNotifyExpiredJobParties).toHaveBeenCalledTimes(3)
    expect(mockNotifyExpiredJobParties).toHaveBeenCalledWith({ jobRequestId: 'jr-sr' })
  })

  it('does not notify when the request raced into another status (no transition)', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([{ id: 'jr-1', status: 'SHORTLIST_READY' }])
    // By the time the expiry transaction reads it, the customer selected a provider.
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'PROVIDER_CONFIRMATION_PENDING' })

    const result = await sweepStrandedJobRequests({ now: NOW })

    expect(result.expired).toBe(0)
    expect(mockNotifyExpiredJobParties).not.toHaveBeenCalled()
  })

  it('keeps sweeping when a notification fails', async () => {
    mockDb.jobRequest.findMany.mockResolvedValue([
      { id: 'jr-1', status: 'PENDING_VALIDATION' },
      { id: 'jr-2', status: 'PENDING_VALIDATION' },
    ])
    mockDb.jobRequest.findUnique
      .mockResolvedValueOnce({ id: 'jr-1', status: 'PENDING_VALIDATION' })
      .mockResolvedValueOnce({ id: 'jr-2', status: 'PENDING_VALIDATION' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockNotifyExpiredJobParties
      .mockRejectedValueOnce(new Error('meta 131047'))
      .mockResolvedValueOnce({ customerNotified: true, providerNotified: false })

    const result = await sweepStrandedJobRequests({ now: NOW })

    expect(result.expired).toBe(2)
    expect(result.notified).toBe(1)
    expect(result.errors).toBe(0)
  })
})

describe('expireOpenJobRequest status guard (CJ-08 extension)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb))
    mockDb.jobRequest.updateMany.mockResolvedValue({ count: 1 })
  })

  it('default behaviour unchanged: refuses to expire SHORTLIST_READY without opt-in', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'SHORTLIST_READY' })

    const result = await expireOpenJobRequest('jr-1', 'max_age_exceeded')

    expect(result.transitioned).toBe(false)
    expect(mockDb.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('default behaviour unchanged: still expires OPEN', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'OPEN' })

    const result = await expireOpenJobRequest('jr-1', 'max_age_exceeded')

    expect(result.transitioned).toBe(true)
    expect(mockDb.jobRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'jr-1', status: { in: ['OPEN', 'MATCHING'] } },
      data: { status: 'EXPIRED' },
    })
  })

  it('expires an opted-in stranded status', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'PENDING_VALIDATION' })

    const result = await expireOpenJobRequest('jr-1', 'validation_window_exceeded', {
      allowedStatuses: ['PENDING_VALIDATION'],
    })

    expect(result.transitioned).toBe(true)
  })

  it('reports no transition when the CAS write is lost to a race', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr-1', status: 'OPEN' })
    mockDb.jobRequest.updateMany.mockResolvedValue({ count: 0 })

    const result = await expireOpenJobRequest('jr-1')

    expect(result.transitioned).toBe(false)
  })
})
