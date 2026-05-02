import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClientPwaHandoff } from '../../lib/client-pwa-handoff'

const { mockEnsureJobRequestAccessToken, mockResolveJobRequestAccessToken } = vi.hoisted(() => ({
  mockResolveJobRequestAccessToken: vi.fn(),
  mockEnsureJobRequestAccessToken: vi.fn(),
}))

vi.mock('../../lib/job-request-access', () => ({
  ensureJobRequestAccessToken: mockEnsureJobRequestAccessToken,
  resolveJobRequestAccessToken: mockResolveJobRequestAccessToken,
}))

function makeResolved(status: string) {
  return {
    status: 'active',
    jobRequest: {
      id: 'request-1',
      status,
    },
  }
}

describe('client PWA handoff resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes stale shortlist links to job tracking after the request is matched', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue(makeResolved('MATCHED'))

    const result = await resolveClientPwaHandoff({
      token: 'ticket-token',
      intent: 'shortlist',
    })

    expect(result).toMatchObject({
      status: 'active',
      requestId: 'request-1',
      originalIntent: 'shortlist',
      view: 'job_tracking',
      path: '/requests/access/ticket-token?view=job_tracking',
      reason: 'provider_accepted_or_job_assigned',
    })
  })

  it('routes shortlist-ready requests to shortlist regardless of original matching intent', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue(makeResolved('SHORTLIST_READY'))

    const result = await resolveClientPwaHandoff({
      token: 'ticket-token',
      intent: 'matching_status',
    })

    expect(result.view).toBe('shortlist')
    expect(result.path).toBe('/requests/access/ticket-token?view=shortlist')
  })

  it('routes provider-confirmation pending requests to waiting state', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue(makeResolved('PROVIDER_CONFIRMATION_PENDING'))

    await expect(resolveClientPwaHandoff({ token: 'ticket-token' })).resolves.toMatchObject({
      view: 'provider_confirmation',
      reason: 'selected_provider_confirming',
    })
  })

  it('accepts a trusted request reference by issuing the canonical ticket token', async () => {
    mockEnsureJobRequestAccessToken.mockResolvedValue({ token: 'issued-token' })
    mockResolveJobRequestAccessToken.mockResolvedValue(makeResolved('OPEN'))

    const result = await resolveClientPwaHandoff({
      jobRequestId: 'request-1',
      intent: 'request_form',
    })

    expect(mockEnsureJobRequestAccessToken).toHaveBeenCalledWith('request-1')
    expect(result).toMatchObject({
      status: 'active',
      requestId: 'request-1',
      originalIntent: 'request_form',
      view: 'matching_status',
      path: '/requests/access/issued-token?view=matching_status',
    })
  })

  it('returns controlled recovery when neither token nor request reference is present', async () => {
    await expect(resolveClientPwaHandoff({ intent: 'shortlist' })).resolves.toMatchObject({
      status: 'invalid',
      requestId: null,
      view: 'invalid_link',
      path: '/requests/access/recovery?reason=invalid',
      reason: 'missing_token_or_request_reference',
    })
  })

  it('returns a controlled expired-link recovery target', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'expired',
      jobRequest: { id: 'request-1', status: 'SHORTLIST_READY' },
    })

    await expect(resolveClientPwaHandoff({ token: 'ticket-token' })).resolves.toMatchObject({
      status: 'expired',
      requestId: 'request-1',
      view: 'expired_link',
      path: '/requests/access/recovery?reason=expired',
    })
  })

  it('returns a controlled invalid-link recovery target', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'invalid',
      jobRequest: null,
    })

    await expect(resolveClientPwaHandoff({ token: 'missing-token' })).resolves.toMatchObject({
      status: 'invalid',
      requestId: null,
      view: 'invalid_link',
      path: '/requests/access/recovery?reason=invalid',
    })
  })
})
