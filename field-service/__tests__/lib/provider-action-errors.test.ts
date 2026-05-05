import { describe, expect, it } from 'vitest'
import {
  getProviderActionClientErrorMessage,
  getProviderPhotoRouteErrorMessage,
  getProviderStatusRouteErrorMessage,
} from '@/lib/provider-action-errors'

describe('provider action error mapping', () => {
  it('maps invalid job transitions to a safe provider-facing status message', () => {
    expect(
      getProviderStatusRouteErrorMessage(
        new Error('Invalid job transition: STARTED -> ARRIVED'),
      ),
    ).toBe('This job can no longer move to that step. Refresh the page and try again.')
  })

  it('maps upload internals to a safe provider-facing photo message', () => {
    expect(
      getProviderPhotoRouteErrorMessage(
        new Error('blob put failed: upstream timeout stack trace'),
      ),
    ).toBe('We could not upload the photo right now. Please try again.')
  })

  it('maps expired session responses to a clear provider-facing client message', () => {
    expect(
      getProviderActionClientErrorMessage({
        action: 'quote',
        status: 401,
      }),
    ).toBe('Your session has expired. Sign in again to continue.')
  })
})
