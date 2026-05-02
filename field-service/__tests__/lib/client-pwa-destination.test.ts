import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockResolveJobRequestAccessToken } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: {
      findUnique: vi.fn(),
    },
    job: {
      findUnique: vi.fn(),
    },
  },
  mockResolveJobRequestAccessToken: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

vi.mock('../../lib/job-request-access', () => ({
  ensureJobRequestAccessToken: vi.fn(),
  resolveJobRequestAccessToken: mockResolveJobRequestAccessToken,
}))

function makeRequest(overrides: Record<string, any> = {}) {
  return {
    id: 'request-1',
    status: 'SHORTLIST_READY',
    match: null,
    ...overrides,
  }
}

describe('client PWA destination resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes stale token links from shortlist intent to job tracking when a job exists', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'active',
      jobRequest: makeRequest({
        status: 'MATCHED',
        match: {
          booking: {
            id: 'booking-1',
            job: { id: 'job-1', status: 'SCHEDULED' },
          },
        },
      }),
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({
      token: 'ticket-token',
      intendedScreen: 'shortlist',
    })

    expect(result).toMatchObject({
      screen: 'job_tracking',
      route: '/requests/access/ticket-token?view=job_tracking',
      accessLevel: 'public_token',
      reason: 'job_scheduled_or_provider_en_route',
    })
    expect(result.allowedActions).toEqual(['track_job'])
  })

  it('routes authenticated request references with completed jobs to the review route', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(
      makeRequest({
        status: 'MATCHED',
        match: {
          booking: {
            id: 'booking-1',
            job: { id: 'job-1', status: 'COMPLETED' },
          },
        },
      }),
    )

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({ requestId: 'request-1' })

    expect(result).toMatchObject({
      screen: 'completion_review',
      route: '/bookings/booking-1/rate',
      accessLevel: 'trusted_reference',
      reason: 'job_completed_review_available',
    })
    expect(result.allowedActions).toEqual(['track_job', 'leave_review'])
  })

  it('returns controlled recovery for invalid tokens', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'invalid',
      jobRequest: null,
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({ token: 'missing-token' })

    expect(result).toMatchObject({
      screen: 'invalid_link',
      route: '/requests/access/recovery?reason=invalid',
      accessLevel: 'invalid',
      reason: 'token_not_found',
    })
  })
})
