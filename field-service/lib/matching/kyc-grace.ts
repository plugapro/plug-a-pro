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

// KYC outcomes that must NEVER be grandfathered. Grace only bridges providers who
// simply haven't completed KYC yet — a provider whose identity check actively
// FAILED (REJECTED) or lapsed (EXPIRED) is outside the identity boundary and must
// not be re-admitted to matching or lead-unlock by the date-based grace.
export const KYC_GRACE_INELIGIBLE_STATUSES = ['REJECTED', 'EXPIRED'] as const

/**
 * True when a non-VERIFIED provider is grandfathered: grace on, created before the
 * cutoff, and not in a terminal-fail KYC state (REJECTED/EXPIRED). `kycStatus` is
 * optional only for legacy callers; always pass it where the value is known.
 */
export function isKycGrandfathered(
  createdAt: Date | null | undefined,
  graceEnabled: boolean,
  kycStatus?: string | null,
): boolean {
  if (!graceEnabled || createdAt == null || createdAt >= KYC_GRACE_CUTOFF) return false
  if (kycStatus && (KYC_GRACE_INELIGIBLE_STATUSES as readonly string[]).includes(kycStatus)) {
    return false
  }
  return true
}

/**
 * Prisma `where` fragment that enforces KYC at provider visibility / lookup time.
 *
 * Always-on rule: kycStatus === 'VERIFIED'. When the legacy grace flag is ON,
 * additionally admit providers created before KYC_GRACE_CUTOFF whose KYC has
 * NOT actively failed (REJECTED/EXPIRED stay excluded). Mirrors the matching
 * filter (lib/matching/filter.ts) so customer-facing visibility cannot drift.
 *
 * This is defense-in-depth: today the provider.verified=true approval gate is
 * KYC-aware (PR #114, behind provider.kyc.required_for_activation), but an
 * explicit kycStatus condition on the where clause means that even if a future
 * change weakens the approval pipeline, customers still cannot see or pick a
 * provider whose identity has not been verified.
 */
export function buildProviderKycVisibilityWhere(graceEnabled: boolean): Record<string, unknown> {
  if (!graceEnabled) {
    return { kycStatus: 'VERIFIED' }
  }
  return {
    OR: [
      { kycStatus: 'VERIFIED' },
      {
        AND: [
          { createdAt: { lt: KYC_GRACE_CUTOFF } },
          { kycStatus: { notIn: [...KYC_GRACE_INELIGIBLE_STATUSES] } },
        ],
      },
    ],
  }
}
