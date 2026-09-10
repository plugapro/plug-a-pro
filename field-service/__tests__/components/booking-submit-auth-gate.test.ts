// ─── Booking submit auth gate (customer.booking.inline_otp) ───────────────────
// Pure decision logic for what BookingFlow.handleConfirm does when the
// bookings POST is rejected with an auth status. Extracted so the 401-retry
// behaviour is unit-testable without a DOM.

import { describe, expect, it } from 'vitest'
import {
  nextActionForAuthFailure,
  resolveSubmitErrorMessage,
} from '@/components/customer/bookingSubmitAuthGate'

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

  // ── VodaPay bridge login (Task 15) ────────────────────────────────────────
  // vodapayAvailable takes priority over the inline-OTP dialog: when the
  // mini-program bridge is present, the federated login is a strictly better
  // UX than an inline OTP form inside a WebView.

  it('vodapay channel with bridge → open_vodapay', () => {
    expect(
      nextActionForAuthFailure({
        status: 401,
        flagEnabled: true,
        alreadyRetried: false,
        vodapayAvailable: true,
      }),
    ).toBe('open_vodapay')
  })

  it('vodapay unavailable falls back to dialog', () => {
    expect(
      nextActionForAuthFailure({
        status: 401,
        flagEnabled: true,
        alreadyRetried: false,
        vodapayAvailable: false,
      }),
    ).toBe('open_dialog')
  })

  it('vodapay available but the inline-OTP flag is off still opens vodapay (independent gates)', () => {
    expect(
      nextActionForAuthFailure({
        status: 403,
        flagEnabled: false,
        alreadyRetried: false,
        vodapayAvailable: true,
      }),
    ).toBe('open_vodapay')
  })

  it('vodapay available but already retried → redirect (safety valve, no infinite bridge-login loop)', () => {
    expect(
      nextActionForAuthFailure({
        status: 401,
        flagEnabled: true,
        alreadyRetried: true,
        vodapayAvailable: true,
      }),
    ).toBe('redirect')
  })

  it('omitting vodapayAvailable behaves exactly like passing false (back-compat default)', () => {
    expect(
      nextActionForAuthFailure({ status: 401, flagEnabled: true, alreadyRetried: false }),
    ).toBe('open_dialog')
  })
})

describe('resolveSubmitErrorMessage', () => {
  const GENERIC = 'We could not submit your request right now. Please try again.'
  const REVIEW = 'Please review your address and job details, then try again.'

  it('surfaces the server message on a 422 serviceability rejection', () => {
    expect(
      resolveSubmitErrorMessage(422, { message: 'We are not active in this area yet.' }),
    ).toBe('We are not active in this area yet.')
  })

  it('surfaces the server message on a 429 active-request cap', () => {
    expect(
      resolveSubmitErrorMessage(429, {
        message: 'You have too many active service requests. Please wait for one to be resolved before submitting a new one.',
      }),
    ).toBe(
      'You have too many active service requests. Please wait for one to be resolved before submitting a new one.',
    )
  })

  it('uses the review copy for a 400 with no usable message', () => {
    expect(resolveSubmitErrorMessage(400, null)).toBe(REVIEW)
    expect(resolveSubmitErrorMessage(400, {})).toBe(REVIEW)
  })

  it('falls back to generic copy for a 500 (no message leaks internals)', () => {
    // 500 returns only { error: 'Failed to create job request' } — no message.
    expect(resolveSubmitErrorMessage(500, {})).toBe(GENERIC)
    expect(resolveSubmitErrorMessage(500, null)).toBe(GENERIC)
  })

  it('ignores a blank/whitespace message and falls back', () => {
    expect(resolveSubmitErrorMessage(422, { message: '   ' })).toBe(GENERIC)
  })

  it('ignores a non-string message and falls back', () => {
    expect(resolveSubmitErrorMessage(422, { message: 42 })).toBe(GENERIC)
  })
})
