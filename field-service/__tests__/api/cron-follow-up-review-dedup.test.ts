import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// CJ-02 reader tolerance: the follow-up cron must dedupe against reviews
// written with EITHER matchId or jobId, or customers who reviewed via the
// /review/[token] link (matchId-only legacy rows) get re-nudged.

const { mockDb, mockSendFollowUp, mockHasSuccessfulMessageForBooking, mockGetJobRequestAccessUrl } = vi.hoisted(() => ({
  mockDb: {
    booking: { findMany: vi.fn() },
    review: { findMany: vi.fn() },
  },
  mockSendFollowUp: vi.fn(),
  mockHasSuccessfulMessageForBooking: vi.fn(),
  mockGetJobRequestAccessUrl: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp', () => ({ sendFollowUp: mockSendFollowUp }))
vi.mock('@/lib/message-events', () => ({ hasSuccessfulMessageForBooking: mockHasSuccessfulMessageForBooking }))
vi.mock('@/lib/job-request-access', () => ({ getJobRequestAccessUrl: mockGetJobRequestAccessUrl }))

function makeBooking(id: string, matchId: string, jobId: string) {
  return {
    id,
    matchId,
    job: { id: jobId },
    match: {
      jobRequest: {
        id: `jr-${id}`,
        customer: { name: 'Thandi', phone: '+27820000001' },
      },
    },
  }
}

describe('GET /api/cron/follow-up — review dedup tolerates both keys', () => {
  const ORIGINAL_ENV = { ...process.env }
  const CRON_SECRET = 'cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIGINAL_ENV, CRON_SECRET }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    mockHasSuccessfulMessageForBooking.mockResolvedValue(false)
    mockGetJobRequestAccessUrl.mockResolvedValue('https://app.example/requests/access/tok')
    mockSendFollowUp.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = ORIGINAL_ENV
  })

  async function run() {
    const { GET } = await import('@/app/api/cron/follow-up/route')
    return GET(
      new Request('http://localhost/api/cron/follow-up', {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }),
    )
  }

  it('skips bookings whose review exists under jobId OR matchId, sends for unreviewed', async () => {
    mockDb.booking.findMany.mockResolvedValue([
      makeBooking('b1', 'match-1', 'job-1'), // reviewed via jobId (legacy rate page)
      makeBooking('b2', 'match-2', 'job-2'), // reviewed via matchId only (legacy token page)
      makeBooking('b3', 'match-3', 'job-3'), // not reviewed → follow-up
    ])
    mockDb.review.findMany.mockResolvedValue([
      { jobId: 'job-1', matchId: null },
      { jobId: null, matchId: 'match-2' },
    ])

    const response = await run()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sent).toBe(1)
    expect(mockSendFollowUp).toHaveBeenCalledTimes(1)
    expect(mockSendFollowUp).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b3' }))
    // The dedup query itself must search across BOTH keys.
    expect(mockDb.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reviewerType: 'CUSTOMER',
          OR: [
            { jobId: { in: ['job-1', 'job-2', 'job-3'] } },
            { matchId: { in: ['match-1', 'match-2', 'match-3'] } },
          ],
        }),
      }),
    )
  })

  it('rejects unauthenticated requests', async () => {
    const { GET } = await import('@/app/api/cron/follow-up/route')
    const response = await GET(new Request('http://localhost/api/cron/follow-up'))
    expect(response.status).toBe(401)
  })
})
