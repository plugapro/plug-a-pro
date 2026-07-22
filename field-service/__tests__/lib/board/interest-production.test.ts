import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockDb, mockGenerateShortlist } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
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
