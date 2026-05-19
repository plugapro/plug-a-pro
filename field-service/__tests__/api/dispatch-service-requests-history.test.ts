import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireRoleApi,
  mockGetCorrelationId,
  mockLogWithCorrelation,
  mockGetDispatchHistory,
  mockGetLeadNotificationSummaryForJobRequest,
} = vi.hoisted(() => ({
  mockRequireRoleApi: vi.fn(),
  mockGetCorrelationId: vi.fn(),
  mockLogWithCorrelation: vi.fn(),
  mockGetDispatchHistory: vi.fn(),
  mockGetLeadNotificationSummaryForJobRequest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRoleApi: mockRequireRoleApi,
}))

vi.mock('@/lib/correlation', () => ({
  getCorrelationId: mockGetCorrelationId,
  logWithCorrelation: mockLogWithCorrelation,
}))

vi.mock('@/lib/matching/service', () => ({
  getDispatchHistory: mockGetDispatchHistory,
  getLeadNotificationSummaryForJobRequest: mockGetLeadNotificationSummaryForJobRequest,
}))

const VALID_JOB_REQUEST_ID = 'job_request-123456'

function makeParams(id = VALID_JOB_REQUEST_ID) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/dispatch/service-requests/[id]/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRoleApi.mockResolvedValue({
      id: 'admin-1',
      adminUserId: 'admin-user-1',
      adminRole: 'ADMIN',
      email: 'ops@example.com',
      phone: '+27821234567',
      role: 'admin',
    })
    mockGetCorrelationId.mockResolvedValue('corr-1')
    mockLogWithCorrelation.mockResolvedValue(undefined)
    mockGetDispatchHistory.mockResolvedValue([
      {
        dispatchDecision: {
          id: 'decision-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          jobRequestId: VALID_JOB_REQUEST_ID,
          status: 'OFFERING',
          selectedProviderId: null,
          actorRole: 'SYSTEM',
          actorId: null,
          mode: 'AUTO_ASSIGN',
          reasonCode: null,
          overrideProviderId: null,
          overrideReason: null,
          scoreRefreshTriggeredAt: null,
          notes: null,
        },
        attempts: [],
      },
    ])
    mockGetLeadNotificationSummaryForJobRequest.mockResolvedValue({
      jobRequestId: VALID_JOB_REQUEST_ID,
      jobRequestStatus: 'MATCHING',
      assignmentMode: 'AUTO_ASSIGN',
      providers: [
        {
          leadId: 'lead-1',
          providerId: 'provider-1',
          providerName: 'Provider One',
          providerPhone: '+27110000000',
          leadStatus: 'SENT',
          leadSentAt: new Date('2026-05-01T08:00:00.000Z'),
          leadNotifiedAt: new Date('2026-05-01T08:01:00.000Z'),
          leadNotificationAttemptedAt: new Date('2026-05-01T08:00:30.000Z'),
          isNotified: true,
          notNotifiedReason: null,
          leadOfferTemplate: 'quick_match_provider_lead_offer',
          leadOfferStatus: 'SENT',
          leadOfferFailureReason: null,
          actionTemplate: null,
          actionStatus: null,
          actionFailureReason: null,
          latestMessageEventId: 'msg-1',
        },
      ],
    })
  })

  it('returns 401 when the admin actor is unauthorized', async () => {
    const unauthorized = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockRequireRoleApi.mockResolvedValue(unauthorized)

    const { GET } = await import('@/app/api/dispatch/service-requests/[id]/history/route')
    const response = await GET(
      new Request(`http://localhost/api/dispatch/service-requests/${VALID_JOB_REQUEST_ID}/history`),
      makeParams(),
    )

    expect(response.status).toBe(401)
  })

  it('returns 400 for an invalid jobRequestId', async () => {
    const { GET } = await import('@/app/api/dispatch/service-requests/[id]/history/route')
    const response = await GET(
      new Request('http://localhost/api/dispatch/service-requests/bad/history'),
      makeParams('bad'),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid jobRequestId')
    expect(mockGetDispatchHistory).not.toHaveBeenCalled()
    expect(mockGetLeadNotificationSummaryForJobRequest).not.toHaveBeenCalled()
  })

  it('returns 404 when the job request does not exist', async () => {
    mockGetLeadNotificationSummaryForJobRequest.mockResolvedValue(null)

    const { GET } = await import('@/app/api/dispatch/service-requests/[id]/history/route')
    const response = await GET(
      new Request(`http://localhost/api/dispatch/service-requests/${VALID_JOB_REQUEST_ID}/history`),
      makeParams(),
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Job request not found')
    expect(mockGetDispatchHistory).toHaveBeenCalledWith(VALID_JOB_REQUEST_ID)
  })

  it('returns provider notification summary and dispatch history when available', async () => {
    const { GET } = await import('@/app/api/dispatch/service-requests/[id]/history/route')
    const response = await GET(
      new Request(`http://localhost/api/dispatch/service-requests/${VALID_JOB_REQUEST_ID}/history`),
      makeParams(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.jobRequestId).toBe(VALID_JOB_REQUEST_ID)
    expect(body.assignmentMode).toBe('AUTO_ASSIGN')
    expect(body.jobRequestStatus).toBe('MATCHING')
    expect(body.history).toHaveLength(1)
    expect(body.providerNotifications).toHaveLength(1)
    expect(body.providerNotifications[0].providerId).toBe('provider-1')
    expect(body.providerNotifications[0].isNotified).toBe(true)
  })

  it('returns 500 when the diagnostics query throws', async () => {
    mockGetLeadNotificationSummaryForJobRequest.mockRejectedValue(new Error('database timeout'))

    const { GET } = await import('@/app/api/dispatch/service-requests/[id]/history/route')
    const response = await GET(
      new Request(`http://localhost/api/dispatch/service-requests/${VALID_JOB_REQUEST_ID}/history`),
      makeParams(),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Failed to load dispatch history')
  })
})
