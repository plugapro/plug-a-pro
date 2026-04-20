/** SLA timeouts in hours per operation type. */
export const SLA = {
  DISPUTE_RESOLUTION: 72,       // 3 days
  KYC_VERIFICATION: 48,         // 2 days
  APPLICATION_REVIEW: 24,       // 1 day
  CUSTOMER_COMPLAINT: 24,       // 1 day
  PROVIDER_ONBOARDING: 24,      // 1 day
  PAYMENT_FOLLOW_UP: 4,         // 4 hours
  FIELD_EXCEPTION_RESPONSE: 2,  // 2 hours
  VALIDATION_QUEUE: 1,          // 1 hour
  DISPATCH_QUEUE: 0.5,          // 30 minutes
} as const

export type SlaKey = keyof typeof SLA

/** Returns the absolute deadline given a start time and an SLA key. */
export function getSlaDeadline(startTime: Date, key: SlaKey): Date {
  const ms = SLA[key] * 60 * 60 * 1000
  return new Date(startTime.getTime() + ms)
}

/** Returns true when now is past the deadline. */
export function isSlaBreached(deadline: Date, now = new Date()): boolean {
  return now > deadline
}

/** Remaining hours until breach — negative when already breached. */
export function slaHoursRemaining(deadline: Date, now = new Date()): number {
  return (deadline.getTime() - now.getTime()) / (60 * 60 * 1000)
}
