import { isKycGrandfathered } from '@/lib/matching/kyc-grace'

export type ProviderLeadEligibilityCode =
  | 'PROVIDER_NOT_ACTIVE'
  | 'PROVIDER_NOT_APPROVED'
  | 'KYC_REQUIRED'

// KYC statuses that signal active failure — must NEVER pass any KYC gate even
// when the legacy or per-provider grace window is otherwise active. Mirrors
// lib/matching/kyc-grace.ts#KYC_GRACE_INELIGIBLE_STATUSES; duplicated here so
// the approval-side guard does not have to import grace internals.
const KYC_HARD_FAIL_STATUSES = new Set(['REJECTED', 'EXPIRED'])

export type ProviderLeadEligibilitySubject = {
  active: boolean
  verified: boolean
  status: string
}

/**
 * Marketplace approval gate for *viewing* a lead preview (no PII, no credit spend).
 * This intentionally does NOT require KYC: a provider must be able to see the
 * preview and the "confirm unlock" prompt before any credit is spent. Identity
 * (KYC) is enforced separately at unlock/credit-spend time - see
 * checkProviderCanUnlockLead below.
 */
export function checkPhaseOneLeadDetailEligibility(provider: ProviderLeadEligibilitySubject):
  | { ok: true }
  | { ok: false; code: ProviderLeadEligibilityCode } {
  if (!provider.active || provider.status === 'SUSPENDED' || provider.status === 'ARCHIVED' || provider.status === 'BANNED') {
    return { ok: false, code: 'PROVIDER_NOT_ACTIVE' }
  }

  if (!provider.verified || provider.status !== 'ACTIVE') {
    return { ok: false, code: 'PROVIDER_NOT_APPROVED' }
  }

  return { ok: true }
}

export type ProviderUnlockEligibilitySubject = ProviderLeadEligibilitySubject & {
  // Identity verification status (Provider.kycStatus). Marketplace approval flags
  // (active/verified/status) are NOT identity guarantees, so unlocking a lead -
  // which spends a credit and reveals the customer's contact and exact address -
  // additionally requires a VERIFIED KYC outcome (or the scoped legacy grace).
  kycStatus: string
  // Sign-up time, used by the scoped legacy KYC grace to grandfather pre-cutoff providers.
  createdAt?: Date | null
  // TRUST+ admin escape hatch (setProviderKycOverrideAction). When set the
  // operator has explicitly cleared this provider to bypass the KYC gate; the
  // override is audited separately via crudAction. Mirrors checkCanBeApproved
  // semantics so a single mental model applies at approval-time AND at
  // matching/unlock-time. Optional so existing callers that omit the field
  // keep their current (pre-override) behaviour.
  kycOverriddenAt?: Date | null
}

/**
 * Credit-spend / unlock gate. Builds on the approval gate above and additionally
 * requires KYC verification before a lead can be unlocked. active/verified/status
 * are marketplace approval flags, not identity guarantees, so unlocking a lead -
 * which exposes customer PII and spends a credit - requires kycStatus === 'VERIFIED'
 * UNLESS a TRUST+ admin has set kycOverriddenAt (audited escape hatch — same
 * pass order as checkCanBeApproved).
 */
export function checkProviderCanUnlockLead(
  provider: ProviderUnlockEligibilitySubject,
  kycGraceEnabled = false,
):
  | { ok: true }
  | { ok: false; code: ProviderLeadEligibilityCode } {
  const approval = checkPhaseOneLeadDetailEligibility(provider)
  if (!approval.ok) return approval

  // Admin override is always sufficient — even for REJECTED/EXPIRED. The audit
  // trail (who set it, when, why) lives on the AuditLog + AdminAuditEvent rows
  // written by setProviderKycOverrideAction via crudAction(). This mirrors
  // checkCanBeApproved so an admin who has cleared a provider does not get
  // tripped at matching/unlock-time by a stale unlock-side gate.
  if (provider.kycOverriddenAt) return { ok: true }

  if (
    provider.kycStatus !== 'VERIFIED' &&
    !isKycGrandfathered(provider.createdAt, kycGraceEnabled, provider.kycStatus)
  ) {
    return { ok: false, code: 'KYC_REQUIRED' }
  }

  return { ok: true }
}

// ─── Approval-time KYC gate ──────────────────────────────────────────────────
//
// checkCanBeApproved is the single source of truth used by every code path that
// can flip a provider to verified=true / status=ACTIVE: syncProviderRecord,
// verifyProviderAction, setProviderStatusAction(ACTIVE), approveApplication,
// autoApproveProviderApplications. It is intentionally pure: callers pass the
// already-resolved policy + grace flag state so the function stays trivially
// testable and side-effect free.
//
// Pass order (first match wins):
//   1. kycRequired = false                      → ok (backwards compatible)
//   2. kycStatus = VERIFIED                     → ok
//   3. kycOverriddenAt set                      → ok (TRUST+ override; audit
//                                                   written separately by
//                                                   crudAction)
//   4. NOT REJECTED/EXPIRED AND
//      (per-provider kycGraceUntil in the future
//       OR legacy grace flag on AND createdAt < KYC_GRACE_CUTOFF) → ok
//   5. otherwise                                → { ok:false, code:'KYC_REQUIRED' }
//
// REJECTED / EXPIRED can ONLY pass via an explicit admin override; date-based
// grace never re-admits them. This mirrors KYC_GRACE_INELIGIBLE_STATUSES on
// the lead-unlock side so a single mental model applies everywhere.

export type ProviderApprovalEligibilitySubject = {
  kycStatus: string
  createdAt?: Date | null
  kycGraceUntil?: Date | null
  kycOverriddenAt?: Date | null
}

export type CanBeApprovedOptions = {
  // Master switch — resolved upstream by lib/kyc-policy.ts#isKycRequiredForActivation()
  // so this function never reads env vars or the DB.
  kycRequired: boolean
  // Whether matching.kyc_grace_legacy_providers is ON in this env. Plumbed
  // through so the test suite can exercise both modes without monkey-patching
  // the flag system.
  kycGraceEnabled: boolean
  // Test seam — defaults to the real clock. Lets the test suite pin "now"
  // when reasoning about kycGraceUntil boundaries.
  now?: Date
}

export function checkCanBeApproved(
  provider: ProviderApprovalEligibilitySubject,
  opts: CanBeApprovedOptions,
):
  | { ok: true }
  | { ok: false; code: 'KYC_REQUIRED' } {
  // 1. Flag off → no enforcement, behave exactly like the pre-PR codebase.
  if (!opts.kycRequired) return { ok: true }

  // 2. Verified is always sufficient.
  if (provider.kycStatus === 'VERIFIED') return { ok: true }

  // 3. Admin override is always sufficient (even for REJECTED/EXPIRED — this
  //    is the documented operator escape hatch; crudAction records who set it
  //    and the reason in the AuditLog + AdminAuditEvent rows).
  if (provider.kycOverriddenAt) return { ok: true }

  // 4. Date-based grace is denied to actively-failed KYC.
  if (KYC_HARD_FAIL_STATUSES.has(provider.kycStatus)) {
    return { ok: false, code: 'KYC_REQUIRED' }
  }

  const now = opts.now ?? new Date()

  // 4a. Per-provider grace window.
  if (provider.kycGraceUntil && provider.kycGraceUntil > now) {
    return { ok: true }
  }

  // 4b. Legacy cohort grace — reuse the matching-side helper so the two
  //     callsites can never drift on what counts as "grandfathered".
  if (isKycGrandfathered(provider.createdAt, opts.kycGraceEnabled, provider.kycStatus)) {
    return { ok: true }
  }

  return { ok: false, code: 'KYC_REQUIRED' }
}

export class ProviderKycGateError extends Error {
  readonly code: 'KYC_REQUIRED'
  constructor(message?: string) {
    super(message ?? 'Provider cannot be approved without verified KYC.')
    this.code = 'KYC_REQUIRED'
    this.name = 'ProviderKycGateError'
  }
}

/**
 * Throw-style sibling of checkCanBeApproved. Convenience for callers that
 * already use try/catch (e.g. crudAction's `run` callback, which lets a
 * thrown CrudActionError become a clean response).
 */
export function assertCanBeApproved(
  provider: ProviderApprovalEligibilitySubject,
  opts: CanBeApprovedOptions,
): void {
  const result = checkCanBeApproved(provider, opts)
  if (!result.ok) {
    throw new ProviderKycGateError(
      'Provider cannot be approved without VERIFIED KYC, an admin override, or a current grace window.',
    )
  }
}
