// Scoped, time-boxed KYC grace for providers approved under the pre-KYC model.
//
// Findings 1a491a69 + 9b32a8f made kycStatus=VERIFIED mandatory for matching and
// lead-unlock. At enforcement time the live provider base was ~97% non-KYC
// (74 of 76 active providers had kycStatus != VERIFIED), which silently removed
// almost every provider from the funnel. This grace re-admits ONLY providers that
// existed before the cutoff, so the marketplace keeps working while legacy
// providers complete KYC; any provider created after the cutoff still requires a
// real VERIFIED outcome regardless of the flag.
//
// Retirement: once the legacy cohort is KYC-verified, set the flag OFF (DB row).
export const KYC_GRACE_FLAG = 'matching.kyc_grace_legacy_providers'

// Providers created strictly before this instant are grandfathered while the flag
// is on. Set to the KYC-enforcement go-live so all then-existing providers qualify
// and all future sign-ups do not.
export const KYC_GRACE_CUTOFF = new Date('2026-06-11T00:00:00.000Z')

/** True when a non-VERIFIED provider is grandfathered (grace on AND created before cutoff). */
export function isKycGrandfathered(
  createdAt: Date | null | undefined,
  graceEnabled: boolean,
): boolean {
  return graceEnabled && createdAt != null && createdAt < KYC_GRACE_CUTOFF
}
