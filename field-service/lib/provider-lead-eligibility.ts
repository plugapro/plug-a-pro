export type ProviderLeadEligibilityCode =
  | 'PROVIDER_NOT_ACTIVE'
  | 'PROVIDER_NOT_APPROVED'
  | 'KYC_REQUIRED'

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
  // additionally requires a VERIFIED KYC outcome.
  kycStatus: string
}

/**
 * Credit-spend / unlock gate. Builds on the approval gate above and additionally
 * requires KYC verification before a lead can be unlocked. active/verified/status
 * are marketplace approval flags, not identity guarantees, so unlocking a lead -
 * which exposes customer PII and spends a credit - requires kycStatus === 'VERIFIED'.
 */
export function checkProviderCanUnlockLead(provider: ProviderUnlockEligibilitySubject):
  | { ok: true }
  | { ok: false; code: ProviderLeadEligibilityCode } {
  const approval = checkPhaseOneLeadDetailEligibility(provider)
  if (!approval.ok) return approval

  if (provider.kycStatus !== 'VERIFIED') {
    return { ok: false, code: 'KYC_REQUIRED' }
  }

  return { ok: true }
}
