import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveClientPwaDestination,
  mockGetCustomerShortlistForRequest,
} = vi.hoisted(() => ({
  mockResolveClientPwaDestination: vi.fn(),
  mockGetCustomerShortlistForRequest: vi.fn(),
}))

vi.mock('../../lib/client-pwa-destination', () => ({
  resolveClientPwaDestination: mockResolveClientPwaDestination,
}))

vi.mock('../../lib/customer-shortlists', () => ({
  getCustomerShortlistForRequest: mockGetCustomerShortlistForRequest,
}))

describe('buildCustomerRequestTicketViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    }
  })
})
