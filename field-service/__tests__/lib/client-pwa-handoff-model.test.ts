/**
 * CLIENT-02 — Client PWA Channel and Handoff Model
 *
 * Covers every entry in the WhatsApp-to-PWA handoff map and validates that
 * the resolver is state-aware: the destination is determined by the current
 * backend state, not by the intent the original link was created for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveClientPwaScreenForState,
  allowedActionsForClientPwaScreen,
} from '../../lib/client-pwa-state'
import type { JobRequestStatus, JobStatus } from '@prisma/client'

// ---------------------------------------------------------------------------
// Resolver mocks for resolveClientPwaDestination
// ---------------------------------------------------------------------------
const { mockDb, mockResolveJobRequestAccessToken } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn() },
    job: { findUnique: vi.fn() },
  },
  mockResolveJobRequestAccessToken: vi.fn(),
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/job-request-access', () => ({
  ensureJobRequestAccessToken: vi.fn(),
  resolveJobRequestAccessToken: mockResolveJobRequestAccessToken,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeJobRequest(
  requestStatus: JobRequestStatus,
  jobStatus?: JobStatus,
): Record<string, unknown> {
  const job = jobStatus ? { id: 'job-1', status: jobStatus } : null
  return {
    id: 'request-1',
    status: requestStatus,
    match: jobStatus
      ? {
          booking: {
            id: 'booking-1',
            job,
          },
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// 1. State-aware resolver unit tests (pure function, no mocks needed)
// ---------------------------------------------------------------------------
describe('resolveClientPwaScreenForState — handoff map coverage', () => {
  // WhatsApp event: "Start request" → request creation
  it('no status → client_home (start request)', () => {
    expect(resolveClientPwaScreenForState({})).toMatchObject({ screen: 'client_home' })
  })

  // WhatsApp event: "Request submitted" → matching status
  it('PENDING_VALIDATION → request_submitted', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'PENDING_VALIDATION' })).toMatchObject({
      screen: 'request_submitted',
      reason: 'request_awaiting_matching_mode',
    })
  })

  // WhatsApp event: "Providers reviewing" → provider response pending
  it('OPEN → matching_progress', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'OPEN' })).toMatchObject({
      screen: 'matching_progress',
    })
  })

  it('MATCHING → providers_reviewing', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHING' })).toMatchObject({
      screen: 'providers_reviewing',
      reason: 'providers_reviewing_request',
    })
  })

  // WhatsApp event: "Shortlist ready" → shortlist
  it('SHORTLIST_READY → shortlist', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'SHORTLIST_READY' })).toMatchObject({
      screen: 'shortlist',
      reason: 'shortlist_ready_for_customer_selection',
    })
  })

  // WhatsApp event: "Provider selected" → waiting for provider confirmation
  it('PROVIDER_CONFIRMATION_PENDING → provider_confirmation', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'PROVIDER_CONFIRMATION_PENDING' })).toMatchObject({
      screen: 'provider_confirmation',
      reason: 'selected_provider_confirming',
    })
  })

  // WhatsApp event: "Provider accepted" / "Arrival confirmed" → job tracking
  it('MATCHED (no job) → job_tracking', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED' })).toMatchObject({
      screen: 'job_tracking',
      reason: 'provider_accepted_or_job_assigned',
    })
  })

  it('MATCHED + SCHEDULED → job_tracking', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'SCHEDULED' })).toMatchObject({
      screen: 'job_tracking',
    })
  })

  it('MATCHED + EN_ROUTE → job_tracking', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'EN_ROUTE' })).toMatchObject({
      screen: 'job_tracking',
    })
  })

  it('MATCHED + ARRIVED → active_job', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'ARRIVED' })).toMatchObject({
      screen: 'active_job',
    })
  })

  it('MATCHED + STARTED → active_job', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'STARTED' })).toMatchObject({
      screen: 'active_job',
    })
  })

  it('MATCHED + AWAITING_APPROVAL → active_job', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'AWAITING_APPROVAL' })).toMatchObject({
      screen: 'active_job',
    })
  })

  it('MATCHED + PENDING_COMPLETION_CONFIRMATION → active_job', () => {
    expect(
      resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'PENDING_COMPLETION_CONFIRMATION' }),
    ).toMatchObject({ screen: 'active_job' })
  })

  // WhatsApp event: "Job completed" → completion/review
  it('MATCHED + COMPLETED → completion_review', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'COMPLETED' })).toMatchObject({
      screen: 'completion_review',
      reason: 'job_completed_review_available',
    })
  })

  it('EXPIRED → expired', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'EXPIRED' })).toMatchObject({
      screen: 'expired',
      reason: 'request_expired',
    })
  })

  it('CANCELLED → cancelled', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'CANCELLED' })).toMatchObject({
      screen: 'cancelled',
      reason: 'request_cancelled',
    })
  })

  it('MATCHED + CANCELLED job → cancelled', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'CANCELLED' })).toMatchObject({
      screen: 'cancelled',
    })
  })

  it('MATCHED + FAILED job → cancelled', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'MATCHED', jobStatus: 'FAILED' })).toMatchObject({
      screen: 'cancelled',
    })
  })
})

// ---------------------------------------------------------------------------
// 2. allowedActions consistency — each screen has a defined action set
// ---------------------------------------------------------------------------
describe('allowedActionsForClientPwaScreen — defined for all screens', () => {
  const screens = [
    'client_home',
    'request_form',
    'request_submitted',
    'matching_progress',
    'providers_reviewing',
    'shortlist',
    'provider_confirmation',
    'job_tracking',
    'active_job',
    'completion_review',
    'cancelled',
    'expired',
    'invalid_link',
  ] as const

  for (const screen of screens) {
    it(`${screen} returns an array`, () => {
      expect(Array.isArray(allowedActionsForClientPwaScreen(screen))).toBe(true)
    })
  }

  it('shortlist includes select_provider and request_more_options', () => {
    const actions = allowedActionsForClientPwaScreen('shortlist')
    expect(actions).toContain('select_provider')
    expect(actions).toContain('request_more_options')
  })

  it('request_submitted includes choose_matching_mode before matching starts', () => {
    const actions = allowedActionsForClientPwaScreen('request_submitted')
    expect(actions).toContain('choose_matching_mode')
    expect(actions).toContain('cancel_request')
  })

  it('job_tracking returns only track_job', () => {
    expect(allowedActionsForClientPwaScreen('job_tracking')).toEqual(['track_job'])
  })

  it('completion_review includes leave_review', () => {
    expect(allowedActionsForClientPwaScreen('completion_review')).toContain('leave_review')
  })

  it('expired has no allowed actions', () => {
    expect(allowedActionsForClientPwaScreen('expired')).toEqual([])
  })

  it('invalid_link has no allowed actions', () => {
    expect(allowedActionsForClientPwaScreen('invalid_link')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. resolveClientPwaDestination — stale-intent and token cases
// ---------------------------------------------------------------------------
describe('resolveClientPwaDestination — stale intent routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Core blueprint requirement: stale shortlist link → current job tracking screen
  it('stale shortlist-intent token routes to job_tracking when request is now MATCHED+SCHEDULED', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'active',
      jobRequest: makeJobRequest('MATCHED', 'SCHEDULED'),
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({
      token: 'stale-shortlist-token',
      intendedScreen: 'shortlist',
    })

    expect(result.screen).toBe('job_tracking')
    expect(result.route).toBe('/requests/access/stale-shortlist-token?view=job_tracking')
    expect(result.accessLevel).toBe('public_token')
    expect(result.allowedActions).toEqual(['track_job'])
  })

  // Stale matching_status intent → shortlist (SHORTLIST_READY)
  it('stale matching-status-intent token routes to shortlist when request is now SHORTLIST_READY', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'active',
      jobRequest: makeJobRequest('SHORTLIST_READY'),
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({
      token: 'old-token',
      intendedScreen: 'matching_progress',
    })

    expect(result.screen).toBe('shortlist')
    expect(result.allowedActions).toContain('select_provider')
  })

  // Stale shortlist intent → provider_confirmation
  it('stale shortlist-intent token routes to provider_confirmation when PROVIDER_CONFIRMATION_PENDING', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'active',
      jobRequest: makeJobRequest('PROVIDER_CONFIRMATION_PENDING'),
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({
      token: 'old-token',
      intendedScreen: 'shortlist',
    })

    expect(result.screen).toBe('provider_confirmation')
    expect(result.allowedActions).toEqual(['view_provider_confirmation'])
  })

  // Stale job_tracking intent → completion_review when job is completed
  it('stale job_tracking-intent token routes to completion_review when MATCHED+COMPLETED', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'active',
      jobRequest: makeJobRequest('MATCHED', 'COMPLETED'),
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({
      token: 'old-job-token',
      intendedScreen: 'job_tracking',
    })

    expect(result.screen).toBe('completion_review')
    expect(result.allowedActions).toContain('leave_review')
  })
})

// ---------------------------------------------------------------------------
// 4. resolveClientPwaDestination — invalid / expired fallback
// ---------------------------------------------------------------------------
describe('resolveClientPwaDestination — recovery fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalid token → screen=invalid_link, route=/requests/access/recovery?reason=invalid', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'invalid',
      jobRequest: null,
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({ token: 'bad-token' })

    expect(result.screen).toBe('invalid_link')
    expect(result.route).toBe('/requests/access/recovery?reason=invalid')
    expect(result.accessLevel).toBe('invalid')
    expect(result.allowedActions).toEqual([])
  })

  it('expired token → screen=expired, route=/requests/access/recovery?reason=expired', async () => {
    mockResolveJobRequestAccessToken.mockResolvedValue({
      status: 'expired',
      jobRequest: makeJobRequest('SHORTLIST_READY'),
    })

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({ token: 'expired-token' })

    expect(result.screen).toBe('expired')
    expect(result.route).toBe('/requests/access/recovery?reason=expired')
    expect(result.accessLevel).toBe('expired')
    expect(result.allowedActions).toEqual([])
  })

  it('missing requestId → returns invalid destination', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(null)

    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({ requestId: 'does-not-exist' })

    expect(result.screen).toBe('invalid_link')
    expect(result.route).toBe('/requests/access/recovery?reason=invalid')
  })

  it('no params → defaults to client_home with no_active_request reason', async () => {
    const { resolveClientPwaDestination } = await import('../../lib/client-pwa-destination')
    const result = await resolveClientPwaDestination({})

    expect(result.screen).toBe('client_home')
    expect(result.reason).toBe('no_active_request')
    expect(result.accessLevel).toBe('trusted_reference')
  })
})

// ---------------------------------------------------------------------------
// 5. Full handoff map — WhatsApp event → correct PWA screen
// ---------------------------------------------------------------------------
describe('full handoff map — WhatsApp event to PWA screen', () => {
  const handoffCases: Array<{
    whatsappEvent: string
    requestStatus: JobRequestStatus
    jobStatus?: JobStatus
    expectedScreen: string
  }> = [
    { whatsappEvent: 'Request submitted', requestStatus: 'PENDING_VALIDATION', expectedScreen: 'request_submitted' },
    { whatsappEvent: 'Providers reviewing', requestStatus: 'MATCHING', expectedScreen: 'providers_reviewing' },
    { whatsappEvent: 'Shortlist ready', requestStatus: 'SHORTLIST_READY', expectedScreen: 'shortlist' },
    { whatsappEvent: 'Provider selected (awaiting confirmation)', requestStatus: 'PROVIDER_CONFIRMATION_PENDING', expectedScreen: 'provider_confirmation' },
    { whatsappEvent: 'Provider accepted (no job yet)', requestStatus: 'MATCHED', expectedScreen: 'job_tracking' },
    { whatsappEvent: 'Arrival confirmed', requestStatus: 'MATCHED', jobStatus: 'EN_ROUTE', expectedScreen: 'job_tracking' },
    { whatsappEvent: 'Job active (arrived)', requestStatus: 'MATCHED', jobStatus: 'ARRIVED', expectedScreen: 'active_job' },
    { whatsappEvent: 'Job completed', requestStatus: 'MATCHED', jobStatus: 'COMPLETED', expectedScreen: 'completion_review' },
  ]

  for (const { whatsappEvent, requestStatus, jobStatus, expectedScreen } of handoffCases) {
    it(`"${whatsappEvent}" → ${expectedScreen}`, () => {
      const result = resolveClientPwaScreenForState({ requestStatus, jobStatus: jobStatus ?? null })
      expect(result.screen).toBe(expectedScreen)
    })
  }
})
