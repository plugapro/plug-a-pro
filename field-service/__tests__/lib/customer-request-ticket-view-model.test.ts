import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveClientPwaDestination,
  mockGetCustomerShortlistForRequest,
  mockGetProviderCandidatesForCustomerReview,
  mockGetCustomerReviewShortlist,
} = vi.hoisted(() => ({
  mockResolveClientPwaDestination: vi.fn(),
  mockGetCustomerShortlistForRequest: vi.fn(),
  mockGetProviderCandidatesForCustomerReview: vi.fn(),
  mockGetCustomerReviewShortlist: vi.fn(),
}))

vi.mock('../../lib/client-pwa-destination', () => ({
  resolveClientPwaDestination: mockResolveClientPwaDestination,
}))

vi.mock('../../lib/customer-shortlists', () => ({
  getCustomerShortlistForRequest: mockGetCustomerShortlistForRequest,
}))

vi.mock('../../lib/review-first', () => ({
  getProviderCandidatesForCustomerReview: mockGetProviderCandidatesForCustomerReview,
  getCustomerReviewShortlist: mockGetCustomerReviewShortlist,
}))

describe('buildCustomerRequestTicketViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderCandidatesForCustomerReview.mockResolvedValue(null)
    mockGetCustomerReviewShortlist.mockResolvedValue(null)
  })

  it('returns unavailable(resolve_failed) when destination resolution throws', async () => {
    mockResolveClientPwaDestination.mockRejectedValue(new Error('enum decode failure'))

    const { buildCustomerRequestTicketViewModel } = await import('../../lib/customer-request-ticket-view-model')
    const result = await buildCustomerRequestTicketViewModel({ token: 'tok-1', intendedScreen: 'matching_status' })

    expect(result.kind).toBe('unavailable')
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('resolve_failed')
      expect(result.destination).toBeNull()
    }
  })

  it('returns unavailable(expired) for expired token destinations', async () => {
    mockResolveClientPwaDestination.mockResolvedValue({
      accessLevel: 'expired',
      screen: 'expired',
      request: { id: 'jr-1', status: 'EXPIRED' },
      reason: 'token_expired_or_revoked',
      route: '/requests/access/recovery?reason=expired',
      allowedActions: [],
      job: null,
    })

    const { buildCustomerRequestTicketViewModel } = await import('../../lib/customer-request-ticket-view-model')
    const result = await buildCustomerRequestTicketViewModel({ token: 'tok-2' })

    expect(result).toMatchObject({
      kind: 'unavailable',
      reason: 'expired',
    })
  })

  it('returns unavailable(invalid) for invalid token destinations', async () => {
    mockResolveClientPwaDestination.mockResolvedValue({
      accessLevel: 'invalid',
      screen: 'invalid_link',
      request: null,
      reason: 'token_not_found',
      route: '/requests/access/recovery?reason=invalid',
      allowedActions: [],
      job: null,
    })

    const { buildCustomerRequestTicketViewModel } = await import('../../lib/customer-request-ticket-view-model')
    const result = await buildCustomerRequestTicketViewModel({ token: 'tok-3' })

    expect(result).toMatchObject({
      kind: 'unavailable',
      reason: 'invalid',
    })
  })

  it('returns ready model even when shortlist lookup fails', async () => {
    mockResolveClientPwaDestination.mockResolvedValue({
      accessLevel: 'public_token',
      screen: 'request_submitted',
      request: { id: 'jr-2', status: 'PENDING_VALIDATION', assignmentMode: 'OPS_REVIEW' },
      reason: 'request_awaiting_matching_mode',
      route: '/requests/access/tok-4',
      allowedActions: ['view_matching_status'],
      job: null,
    })
    mockGetCustomerShortlistForRequest.mockRejectedValue(new Error('relation temporarily unavailable'))

    const { buildCustomerRequestTicketViewModel } = await import('../../lib/customer-request-ticket-view-model')
    const result = await buildCustomerRequestTicketViewModel({ token: 'tok-4' })

    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(result.shortlist).toBeNull()
      expect(result.destination.request?.id).toBe('jr-2')
      expect(result.reviewCandidates).toBeNull()
      expect(result.reviewShortlist).toBeNull()
      expect(mockGetProviderCandidatesForCustomerReview).not.toHaveBeenCalled()
      expect(mockGetCustomerReviewShortlist).not.toHaveBeenCalled()
    }
  })

  it('loads review-first candidates and shortlist for pending OPS_REVIEW tokens', async () => {
    mockResolveClientPwaDestination.mockResolvedValue({
      accessLevel: 'public_token',
      screen: 'request_submitted',
      request: {
        id: 'jr-review-1',
        status: 'PENDING_VALIDATION',
        assignmentMode: 'OPS_REVIEW',
        latestDispatchDecisionId: 'dd-1',
        customer: { id: 'cust-1' },
      },
      reason: 'request_awaiting_matching_mode',
      route: '/requests/access/tok-review',
      allowedActions: ['view_matching_status'],
      job: null,
    })
    mockGetCustomerShortlistForRequest.mockResolvedValue(null)
    mockGetProviderCandidatesForCustomerReview.mockResolvedValue({
      requestId: 'jr-review-1',
      batch: 2,
      hasMore: true,
      candidates: [{ providerId: 'prov-1', name: 'Lovemore' }],
    })
    mockGetCustomerReviewShortlist.mockResolvedValue({
      requestId: 'jr-review-1',
      providers: [{ providerId: 'prov-1', name: 'Lovemore' }],
    })

    const { buildCustomerRequestTicketViewModel } = await import('../../lib/customer-request-ticket-view-model')
    const result = await buildCustomerRequestTicketViewModel({
      token: 'tok-review',
      reviewBatch: 2,
    })

    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(mockGetProviderCandidatesForCustomerReview).toHaveBeenCalledWith({
        requestId: 'jr-review-1',
        customerId: 'cust-1',
        batch: 2,
      })
      expect(mockGetCustomerReviewShortlist).toHaveBeenCalledWith({
        requestId: 'jr-review-1',
        customerId: 'cust-1',
      })
      expect(result.reviewCandidates).toMatchObject({
        batch: 2,
        candidates: [{ providerId: 'prov-1' }],
      })
      expect(result.reviewShortlist).toMatchObject({
        providers: [{ providerId: 'prov-1' }],
      })
    }
  })

  it('keeps loading review-first shortlist after the customer sends it to providers', async () => {
    mockResolveClientPwaDestination.mockResolvedValue({
      accessLevel: 'public_token',
      screen: 'providers_reviewing',
      request: {
        id: 'jr-review-sent',
        status: 'MATCHING',
        assignmentMode: 'OPS_REVIEW',
        latestDispatchDecisionId: 'dd-1',
        customer: { id: 'cust-1' },
      },
      reason: 'providers_reviewing_request',
      route: '/requests/access/tok-review-sent',
      allowedActions: ['view_matching_status'],
      job: null,
    })
    mockGetCustomerShortlistForRequest.mockResolvedValue(null)
    mockGetProviderCandidatesForCustomerReview.mockResolvedValue({
      requestId: 'jr-review-sent',
      batch: 1,
      hasMore: false,
      candidates: [],
    })
    mockGetCustomerReviewShortlist.mockResolvedValue({
      requestId: 'jr-review-sent',
      providers: [{ providerId: 'prov-1', name: 'Lovemore', status: 'SENT' }],
    })

    const { buildCustomerRequestTicketViewModel } = await import('../../lib/customer-request-ticket-view-model')
    const result = await buildCustomerRequestTicketViewModel({
      token: 'tok-review-sent',
      reviewBatch: 1,
    })

    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(mockGetCustomerReviewShortlist).toHaveBeenCalledWith({
        requestId: 'jr-review-sent',
        customerId: 'cust-1',
      })
      expect(result.reviewShortlist).toMatchObject({
        providers: [{ providerId: 'prov-1', status: 'SENT' }],
      })
    }
  })
})
