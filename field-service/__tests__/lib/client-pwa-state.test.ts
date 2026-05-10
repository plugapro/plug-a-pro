import { describe, expect, it } from 'vitest'
import { allowedActionsForClientPwaScreen, resolveClientPwaScreenForState } from '../../lib/client-pwa-state'

describe('client PWA state mapping', () => {
  it('maps shortlist-ready requests to shortlist actions', () => {
    const state = resolveClientPwaScreenForState({ requestStatus: 'SHORTLIST_READY' })

    expect(state).toEqual({
      screen: 'shortlist',
      reason: 'shortlist_ready_for_customer_selection',
    })
    expect(allowedActionsForClientPwaScreen(state.screen)).toEqual([
      'view_shortlist',
      'select_provider',
      'request_more_options',
      'cancel_request',
    ])
  })

  it('lets job state override matched request state', () => {
    expect(
      resolveClientPwaScreenForState({
        requestStatus: 'MATCHED',
        jobStatus: 'PENDING_COMPLETION_CONFIRMATION',
      }),
    ).toEqual({
      screen: 'active_job',
      reason: 'job_active_or_needs_customer_attention',
    })
  })

  it('maps cancelled and expired requests to controlled exception screens', () => {
    expect(resolveClientPwaScreenForState({ requestStatus: 'CANCELLED' })).toEqual({
      screen: 'cancelled',
      reason: 'request_cancelled',
    })
    expect(resolveClientPwaScreenForState({ requestStatus: 'EXPIRED' })).toEqual({
      screen: 'expired',
      reason: 'request_expired',
    })
  })

  it('falls back safely when request status is unknown at runtime', () => {
    const state = resolveClientPwaScreenForState({
      requestStatus: 'UNKNOWN_STATUS' as unknown as never,
    })
    expect(state).toEqual({
      screen: 'matching_progress',
      reason: 'request_status_unmapped',
    })
  })

  it('falls back safely when matched job status is unknown at runtime', () => {
    const state = resolveClientPwaScreenForState({
      requestStatus: 'MATCHED',
      jobStatus: 'UNKNOWN_JOB_STATUS' as unknown as never,
    })
    expect(state).toEqual({
      screen: 'job_tracking',
      reason: 'job_status_unmapped',
    })
  })
})
