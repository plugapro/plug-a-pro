export type ProviderLeadEligibilityCode = 'PROVIDER_NOT_ACTIVE' | 'PROVIDER_NOT_APPROVED'

export type ProviderLeadEligibilitySubject = {
  active: boolean
  verified: boolean
  status: string
}

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
