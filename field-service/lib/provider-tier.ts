// ─── Provider trust tier classifier (West Rand pilot) ───────────────────────
// Pure function. No DB calls. Derives a provider's R1–R5 / PENDING_R1 tier
// from existing fields. Callers (admin readiness report, nudge queue) are
// responsible for joining ProviderIdentityVerification.assuranceLevel and
// ProviderApplication.status into the input shape.
//
// Rules are evaluated top-down; first match wins. See
// docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md §3.2.

export type ProviderTier = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'PENDING_R1'

export type ProviderTierInput = {
  verified: boolean
  kycStatus:
    | 'NOT_STARTED'
    | 'IN_PROGRESS'
    | 'SUBMITTED'
    | 'VERIFIED'
    | 'REJECTED'
    | 'EXPIRED'
  status:
    | 'APPLICATION_PENDING'
    | 'UNDER_REVIEW'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'ARCHIVED'
    | 'BANNED'
  strikes: number
  name: string | null
  phone: string | null
  email: string | null
  payoutVerifiedAt: Date | null
  skills: string[]
  equipmentTags: string[]
  serviceAreas: string[]
  identityAssurance?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  hasApplication?: boolean
  applicationStatus?:
    | 'SUBMITTED'
    | 'UNDER_REVIEW'
    | 'APPROVED'
    | 'REJECTED'
    | null
}

// Order matters: PROFILE_FIELDS_TRACKED is iterated to count missing fields
// and to render the human-readable missing-items list used by the nudge
// template.
export const PROFILE_FIELDS_TRACKED = [
  'name',
  'phone',
  'email',
  'payoutVerifiedAt',
  'skills',
  'equipmentTags',
  'serviceAreas',
] as const

type ProfileField = (typeof PROFILE_FIELDS_TRACKED)[number]

const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  name: 'name',
  phone: 'phone number',
  email: 'email address',
  payoutVerifiedAt: 'bank details',
  skills: 'skills list',
  equipmentTags: 'equipment list',
  serviceAreas: 'service areas',
}

function isFieldMissing(field: ProfileField, p: ProviderTierInput): boolean {
  switch (field) {
    case 'name':
    case 'phone':
    case 'email':
      return !p[field] || p[field]!.trim() === ''
    case 'payoutVerifiedAt':
      return p.payoutVerifiedAt == null
    case 'skills':
    case 'equipmentTags':
    case 'serviceAreas':
      return !p[field] || p[field].length === 0
  }
}

function missingProfileFieldCount(p: ProviderTierInput): number {
  let count = 0
  for (const field of PROFILE_FIELDS_TRACKED) {
    if (isFieldMissing(field, p)) count++
  }
  return count
}

export function listMissingProfileItems(p: ProviderTierInput): string[] {
  const items: string[] = []
  for (const field of PROFILE_FIELDS_TRACKED) {
    if (isFieldMissing(field, p)) items.push(PROFILE_FIELD_LABELS[field])
  }
  return items
}

export function classifyProviderTier(p: ProviderTierInput): ProviderTier | null {
  // PENDING_R1: any pre-active application in review.
  if (
    p.hasApplication &&
    (p.applicationStatus === 'SUBMITTED' || p.applicationStatus === 'UNDER_REVIEW')
  ) {
    return 'PENDING_R1'
  }

  // Excluded: not actively serviceable; not tier-reportable.
  if (p.status === 'SUSPENDED' || p.status === 'BANNED' || p.status === 'ARCHIVED') {
    return null
  }

  // From here we assume status is ACTIVE (or pre-active without an in-review
  // application — which shouldn't surface in readiness counts in practice).
  if (p.status !== 'ACTIVE') {
    return null
  }

  const missingCount = missingProfileFieldCount(p)

  // R5: high-risk incomplete (kyc gap OR no banking OR many profile gaps).
  if (
    p.kycStatus !== 'VERIFIED' ||
    p.payoutVerifiedAt == null ||
    missingCount >= 3
  ) {
    return 'R5'
  }

  // R4: 1–2 profile gaps but everything else solid.
  if (missingCount >= 1) {
    return 'R4'
  }

  // R3 / R2 / R1 differentiate by identity-assurance level + strike count.
  const assurance = p.identityAssurance ?? null
  if (assurance === 'HIGH' && p.strikes === 0) return 'R1'
  if (assurance === 'MEDIUM') return 'R2'
  // HIGH-with-strikes folds to R2 (still a higher-assurance bucket than R3).
  if (assurance === 'HIGH') return 'R2'
  // LOW or null assurance → R3.
  return 'R3'
}
