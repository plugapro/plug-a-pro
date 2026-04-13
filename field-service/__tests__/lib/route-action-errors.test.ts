import { describe, expect, it } from 'vitest'
import {
  getDispatchRouteError,
  getProviderExtraWorkRouteError,
  getPublicQuoteDecisionError,
} from '@/lib/route-action-errors'

describe('route action errors', () => {
  it('maps dispatch not-found errors to a safe operator message', () => {
    expect(
      getDispatchRouteError({
        action: 'assign',
        error: new Error('JOB_REQUEST_NOT_FOUND'),
      }),
    ).toEqual({
      status: 404,
      message: 'This request is no longer available in the dispatch queue.',
    })
  })

  it('maps provider extra-work transition failures to a safe provider message', () => {
    expect(
      getProviderExtraWorkRouteError(
        new Error('Invalid job transition: STARTED -> AWAITING_APPROVAL'),
      ),
    ).toEqual({
      status: 409,
      message: 'This job can no longer request extra work from its current state. Refresh the page and try again.',
    })
  })

  it('maps public quote conflicts to a safe customer message', () => {
    expect(getPublicQuoteDecisionError({ code: 'ALREADY_ACTIONED' })).toEqual({
      status: 409,
      message: 'This quote has already been updated. Refresh the page to see the latest status.',
    })
  })
})
