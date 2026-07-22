import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockDb, mockGenerateShortlist } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
    providerShortlist: { findFirst: vi.fn() },
  },
  mockGenerateShortlist: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/customer-shortlists', () => ({
  generateCustomerShortlistForRequest: mockGenerateShortlist,
}))

import { triggerShortlistProduction } from '@/lib/board/interest'

// I1: triggerShortlistProduction's status pre-check must allow the true
// cap-3 regeneration path — a job already in SHORTLIST_READY (interest #2 or
// #3 landing on a job that already has a published shortlist) must still be
// able to regenerate (generateCustomerShortlistForRequest supersedes the
// prior PUBLISHED shortlist and re-notifies the customer — that IS the
// per-interest notify the spec demands).
describe('triggerShortlistProduction — I1 status pre-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateShortlist.mockResolvedValue(undefined)
    mockDb.providerShortlist.findFirst.mockResolvedValue(null)
  })

  it('calls generateCustomerShortlistForRequest when the job is OPEN', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr1', status: 'OPEN' })
    await triggerShortlistProduction('jr1')
    expect(mockGenerateShortlist).toHaveBeenCalledWith('jr1')
  })

  it('calls generateCustomerShortlistForRequest when the job is MATCHING', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr1', status: 'MATCHING' })
    await triggerShortlistProduction('jr1')
    expect(mockGenerateShortlist).toHaveBeenCalledWith('jr1')
  })

  it('calls generateCustomerShortlistForRequest when the job is SHORTLIST_READY (regeneration/supersede path)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr1', status: 'SHORTLIST_READY' })
    await triggerShortlistProduction('jr1')
    expect(mockGenerateShortlist).toHaveBeenCalledWith('jr1')
  })

  it('does NOT call generateCustomerShortlistForRequest when the job is PROVIDER_CONFIRMATION_PENDING', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr1', status: 'PROVIDER_CONFIRMATION_PENDING' })
    await triggerShortlistProduction('jr1')
    expect(mockGenerateShortlist).not.toHaveBeenCalled()
  })

  it('does NOT call generateCustomerShortlistForRequest when the job is MATCHED', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr1', status: 'MATCHED' })
    await triggerShortlistProduction('jr1')
    expect(mockGenerateShortlist).not.toHaveBeenCalled()
  })

  it('does nothing when the job request no longer exists', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(null)
    await triggerShortlistProduction('jr1')
    expect(mockGenerateShortlist).not.toHaveBeenCalled()
  })
})

// Minor 1 (re-review fix): AUTO_ASSIGN double-generate/notify corner. When
// respondToProviderOpportunity's own maybeAutoTriggerShortlist already
// published a shortlist moments ago for the SAME interest response, this
// wrapper's additive safety-net call must not regenerate (and re-notify) a
// second time.
describe('triggerShortlistProduction — Minor 1 recent-publish skip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateShortlist.mockResolvedValue(undefined)
    mockDb.jobRequest.findUnique.mockResolvedValue({ id: 'jr1', status: 'SHORTLIST_READY' })
  })

  it('skips regeneration when a PUBLISHED shortlist was published within the last 60 seconds', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue({ id: 'shortlist-1' })

    await triggerShortlistProduction('jr1')

    expect(mockDb.providerShortlist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          requestId: 'jr1',
          status: 'PUBLISHED',
          publishedAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    )
    expect(mockGenerateShortlist).not.toHaveBeenCalled()
  })

  it('regenerates when the most recent PUBLISHED shortlist is stale (older than 60 seconds)', async () => {
    // No row matches the `publishedAt: { gte: now - 60s }` filter, so the
    // production query returns null - simulate that directly.
    mockDb.providerShortlist.findFirst.mockResolvedValue(null)

    await triggerShortlistProduction('jr1')

    expect(mockGenerateShortlist).toHaveBeenCalledWith('jr1')
  })

  it('regenerates when there is no PUBLISHED shortlist at all', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue(null)

    await triggerShortlistProduction('jr1')

    expect(mockGenerateShortlist).toHaveBeenCalledWith('jr1')
  })
})
