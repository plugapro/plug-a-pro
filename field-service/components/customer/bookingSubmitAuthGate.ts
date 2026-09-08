// ─── Booking submit auth gate (customer.booking.inline_otp) ───────────────────
// Decides what BookingFlow does when POST /api/customer/bookings is rejected
// with an auth status. Pure module so the 401-retry decision is unit-testable
// in the node vitest environment (no DOM).

export type AuthFailureAction = 'redirect' | 'open_dialog' | 'open_vodapay' | 'none'

export function nextActionForAuthFailure({
  status,
  flagEnabled,
  alreadyRetried,
  vodapayAvailable = false,
}: {
  status: number
  flagEnabled: boolean
  alreadyRetried: boolean
  // VodaPay mini-program bridge login (Task 15). Independent of `flagEnabled`
  // (the customer.booking.inline_otp flag): the bridge is only "available"
  // when we're actually running inside the VodaPay WebView (see
  // lib/vodapay/bridge.ts#detectMiniProgram), in which case a federated login
  // is a strictly better UX than an inline OTP form.
  vodapayAvailable?: boolean
}): AuthFailureAction {
  if (status !== 401 && status !== 403) return 'none'
  // Safety valve first, regardless of path: a retry that STILL comes back
  // unauthorised (session didn't stick after VodaPay login or OTP verify)
  // falls back to the legacy /sign-in redirect so we never loop — whether
  // the loop would be re-prompting the native bridge or the OTP dialog.
  if (alreadyRetried) return 'redirect'
  if (vodapayAvailable) return 'open_vodapay'
  // Flag off → legacy /sign-in redirect.
  if (!flagEnabled) return 'redirect'
  return 'open_dialog'
}

// ─── Booking submit error message ─────────────────────────────────────────────
// Chooses the banner text for a non-auth submit failure. The bookings API
// returns a customer-facing `message` for the cases the customer can act on —
// the serviceability guards (422: "We are not active in this area yet", etc.)
// and the active-request cap (429). Surfacing that message turns an opaque
// "could not submit" into an actionable one. Internal failures (500 returns
// only `error: 'Failed to create job request'`, with no `message`) fall back
// to generic copy so nothing internal leaks to the customer.
//
// Pure so it can be unit-tested in the node vitest environment (no DOM).
export function resolveSubmitErrorMessage(
  status: number,
  body: { message?: unknown } | null | undefined,
): string {
  if (body && typeof body.message === 'string' && body.message.trim().length > 0) {
    return body.message
  }
  if (status === 400) {
    return 'Please review your address and job details, then try again.'
  }
  return 'We could not submit your request right now. Please try again.'
}
