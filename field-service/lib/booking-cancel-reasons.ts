export const BOOKING_CANCEL_REASONS = [
  'Found another provider',
  'No longer needed',
  'Cost too high',
  'Taking too long',
  // B2B reasons
  'Wrong site',
  'Authorisation withdrawn',
  'Procurement on hold',
  'Vendor on existing PO',
  'Other',
] as const

export type BookingCancelReason = (typeof BOOKING_CANCEL_REASONS)[number]
