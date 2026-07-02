// ─── Booking submit auth gate (customer.booking.inline_otp) ───────────────────
// Decides what BookingFlow does when POST /api/customer/bookings is rejected
// with an auth status. Pure module so the 401-retry decision is unit-testable
// in the node vitest environment (no DOM).

export type AuthFailureAction = 'redirect' | 'open_dialog' | 'none'

export function nextActionForAuthFailure({
  status,
  flagEnabled,
  alreadyRetried,
}: {
  status: number
  flagEnabled: boolean
  alreadyRetried: boolean
}): AuthFailureAction {
  if (status !== 401 && status !== 403) return 'none'
  // Flag off → legacy /sign-in redirect. Flag on but the post-OTP retry ALSO
  // came back unauthorised (session didn't stick) → same redirect as a safety
  // valve so we never loop the dialog.
  if (!flagEnabled || alreadyRetried) return 'redirect'
  return 'open_dialog'
}
