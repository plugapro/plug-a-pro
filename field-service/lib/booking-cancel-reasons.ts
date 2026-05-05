// B2B booking reasons are focused on internal approvals and site-specific constraints.
// Keep "Other" for edge cases without hard-coding one-off categories in UI.
export const BOOKING_CANCEL_REASONS = [
  'Wrong site',
  'Authorisation withdrawn',
  'Procurement on hold',
  'Vendor on existing PO',
  'Work scope changed',
  'Other',
] as const

export type BookingCancelReason = (typeof BOOKING_CANCEL_REASONS)[number]
