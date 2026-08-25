// ─── Area service-status presentation helpers ─────────────────────────────────
// Shared by the home AreaSelector and the booking SuburbPicker so both pickers
// present serviceable areas first and mark not-yet-active ones. Duplicate
// suburb names exist across regions (two "Northcliff" nodes — jhb_west and
// jhb_north); without ordering + context the unserviceable twin is
// indistinguishable and dead-ends the booking with a 422 at submit.
//
// Pure module — unit-testable without a DOM.

export type AreaServiceStatus = 'live' | 'onboarding' | 'coming_soon'

const SERVICE_STATUS_ORDER: Record<string, number> = {
  live: 0,
  onboarding: 1,
  coming_soon: 2,
}

/**
 * Sort search results so customer-serviceable ('live') areas come first,
 * then onboarding, then coming_soon. Unknown/missing statuses are treated as
 * coming_soon (last). Stable: within a tier the input order (the API's
 * alphabetical order) is preserved.
 */
export function sortAreaResultsLiveFirst<T extends { serviceStatus?: string }>(results: T[]): T[] {
  return [...results].sort(
    (a, b) =>
      (SERVICE_STATUS_ORDER[a.serviceStatus ?? 'coming_soon'] ?? 2) -
      (SERVICE_STATUS_ORDER[b.serviceStatus ?? 'coming_soon'] ?? 2),
  )
}

/** True when an option should carry a "Not yet active" hint. */
export function isNotYetActive(serviceStatus: string | undefined): boolean {
  return serviceStatus !== undefined && serviceStatus !== 'live'
}
