// Shared leaf constants + helpers for the two verification nudge crons
// (lib/kyc-drive/nudge.ts and lib/identity-verification/in-flight-renudge.ts).
// Lives in its own module so both can import it without a cycle — previously
// the template list was hand-copied between them "kept in sync" by comment.

export const KYC_DRIVE_TEMPLATE = 'provider_kyc_nudge'

export const IN_FLIGHT_TEMPLATE_NAMES = [
  'provider_verification_resume_consent',
  'provider_verification_resume_document',
  'provider_verification_resume_selfie',
] as const

export type InFlightTemplateName = (typeof IN_FLIGHT_TEMPLATE_NAMES)[number]

/**
 * Env-driven batch cap, shared by both nudge crons.
 * - An explicit "0" is a valid operator choice (send nothing this run);
 *   `Number(raw) || DEFAULT` would silently turn it back into the default.
 * - Negatives are treated as an explicit disable (0), not the default —
 *   flipping an operator's "-1 = off" into full volume would invert intent.
 * - Garbage falls back to the caller's default.
 */
export function resolveBatchCap(raw: string | undefined, defaultCap: number): number {
  if (raw === undefined) return defaultCap
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return defaultCap
  return parsed >= 0 ? parsed : 0
}

/**
 * Politeness bookkeeping rule shared by both crons:
 * - LIFETIME caps and SPACING count only events that plausibly reached the
 *   recipient (anything not explicitly FAILED) — a provider who received
 *   nothing keeps their budget.
 * - The short 24h retry floor counts EVERY attempt including FAILED, bounding
 *   retries after failures to at most one per day (the in-flight cron runs
 *   hourly; without this a FAILED attempt frees budget for an hourly storm).
 * Events written before the status column carried failure states have no
 * status field — treat missing as delivered (polite bias).
 */
export function countsTowardCadence(status: string | null | undefined): boolean {
  return status !== 'FAILED'
}
