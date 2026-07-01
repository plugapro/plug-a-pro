// ─── Booking submit auth gate (customer.booking.inline_otp) ───────────────────
// Pure decision logic for what BookingFlow.handleConfirm does when the
// bookings POST is rejected with an auth status. Extracted so the 401-retry
// behaviour is unit-testable without a DOM.

import { describe, expect, it } from 'vitest'
import { nextActionForAuthFailure } from '@/components/customer/bookingSubmitAuthGate'

describe('nextActionForAuthFailure', () => {
  it('opens the inline OTP dialog on 401 when the flag is enabled', () => {
    expect(
      nextActionForAuthFailure({ status: 401, flagEnabled: true, alreadyRetried: false }),
    ).toBe('open_dialog')
  })

  it('opens the inline OTP dialog on 403 when the flag is enabled', () => {
    expect(
      nextActionForAuthFailure({ status: 403, flagEnabled: true, alreadyRetried: false }),
    ).toBe('open_dialog')
  })

  it('redirects on 401 when the flag is disabled (legacy behaviour)', () => {
    expect(
      nextActionForAuthFailure({ status: 401, flagEnabled: false, alreadyRetried: false }),
    ).toBe('redirect')
  })

  it('redirects on 403 when the flag is disabled (legacy behaviour)', () => {
    expect(
      nextActionForAuthFailure({ status: 403, flagEnabled: false, alreadyRetried: false }),
    ).toBe('redirect')
  })

  it('falls back to redirect on a second 401 after an OTP retry (no infinite loop)', () => {
    expect(
      nextActionForAuthFailure({ status: 401, flagEnabled: true, alreadyRetried: true }),
    ).toBe('redirect')
  })

  it('falls back to redirect on a second 403 after an OTP retry', () => {
    expect(
      nextActionForAuthFailure({ status: 403, flagEnabled: true, alreadyRetried: true }),
    ).toBe('redirect')
  })

  it('returns none for a 200 response', () => {
    expect(
      nextActionForAuthFailure({ status: 200, flagEnabled: true, alreadyRetried: false }),
    ).toBe('none')
  })

  it('returns none for non-auth error statuses (400/500)', () => {
    expect(
      nextActionForAuthFailure({ status: 400, flagEnabled: true, alreadyRetried: false }),
    ).toBe('none')
    expect(
      nextActionForAuthFailure({ status: 500, flagEnabled: false, alreadyRetried: false }),
    ).toBe('none')
  })
})
