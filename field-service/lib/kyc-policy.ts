// KYC policy resolution — single source of truth for "is mandatory KYC ON?".
//
// Two inputs control this:
//   1. provider.kyc.required_for_activation feature flag (DB / registry default)
//   2. REQUIRE_PROVIDER_KYC env var ("true" | "false") — env wins, so an
//      operator can pin the rule in code without touching the DB row.
//
// All approval-pipeline gates (lib/provider-lead-eligibility.ts → checkCanBeApproved,
// the admin verify/setStatus/approveApplication actions, autoApproveProviderApplications,
// and the WhatsApp registration flow's no-skip branch) call isKycRequiredForActivation()
// to decide whether to enforce. When this returns false the new fields and the
// new guard are no-ops — the codebase behaves exactly as it did before this PR.

import { isEnabled } from './flags'

export const KYC_REQUIRED_FLAG = 'provider.kyc.required_for_activation' as const

export const KYC_EXISTING_PROVIDER_GRACE_DAYS = Number.parseInt(
  process.env.KYC_EXISTING_PROVIDER_GRACE_DAYS ?? '30',
  10,
)

/**
 * Returns true if mandatory KYC at the approval boundary is ON in this env.
 *
 * Precedence:
 *   1. REQUIRE_PROVIDER_KYC env ("true" | "false") — emergency on/off
 *   2. provider.kyc.required_for_activation flag (DB / registry default)
 */
export async function isKycRequiredForActivation(): Promise<boolean> {
  const envOverride = process.env.REQUIRE_PROVIDER_KYC?.trim().toLowerCase()
  if (envOverride === 'true') return true
  if (envOverride === 'false') return false
  return isEnabled(KYC_REQUIRED_FLAG)
}
