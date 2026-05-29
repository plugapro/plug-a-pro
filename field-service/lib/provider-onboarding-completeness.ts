// ─── Provider onboarding completeness validator ──────────────────────────────
// The single source of truth for "what does an approved provider need before
// they can match jobs and be shown to customers". Used by:
//   - Admin tooling to flag incomplete profiles before approval.
//   - The pre-submit summary to refuse submission if matching/display fields
//     are missing.
//   - Tests that prevent the WhatsApp onboarding flow from drifting away
//     from the data model.
//
// Adding a new required field? Update FIELD_REQUIREMENTS and the
// data-model-to-onboarding mapping doc at
// field-service/docs/provider-onboarding-data-model.md.

export type ProviderProfileLike = {
  name?: string | null
  phone?: string | null
  email?: string | null
  skills?: string[] | null
  serviceAreas?: string[] | null
  /** Structured location node IDs from the LocationNode table. Satisfies
   * the serviceAreas completeness requirement when populated, so callers
   * should pass whichever field they have - either serviceAreas (legacy
   * freetext) or locationNodeIds (structured) or both. */
  locationNodeIds?: string[] | null
  experience?: string | null
  availability?: string | null
  callOutFee?: number | string | null
  hourlyRate?: number | string | null
  rateNegotiable?: boolean | null
  evidenceFileCount?: number | null
  evidenceNote?: string | null
  idNumber?: string | null
  avatarUrl?: string | null
  profilePhotoAttachmentId?: string | null
}

export type CompletenessGroup =
  | 'core_identity'
  | 'service_offering'
  | 'pricing'
  | 'availability_coverage'
  | 'trust_verification'
  | 'customer_display'

export type ProfileCompleteness = {
  ok: boolean
  canSubmit: boolean
  canApprove: boolean
  canShowToCustomers: boolean
  missing: Array<{ field: string; reason: string; group: CompletenessGroup; severity: 'block_submit' | 'block_approve' | 'block_customer_display' | 'recommended' }>
}

const FIELD_REQUIREMENTS: ReadonlyArray<{
  field: keyof ProviderProfileLike
  group: CompletenessGroup
  severity: 'block_submit' | 'block_approve' | 'block_customer_display' | 'recommended'
  reason: string
  satisfiedBy: (profile: ProviderProfileLike) => boolean
}> = [
  // ── Core identity ────────────────────────────────────────────────────────
  {
    field: 'name',
    group: 'core_identity',
    severity: 'block_submit',
    reason: 'Provider name is shown to customers and used in WhatsApp messages.',
    satisfiedBy: (p) => Boolean(p.name?.trim()),
  },
  {
    field: 'phone',
    group: 'core_identity',
    severity: 'block_submit',
    reason: 'Phone is the primary identity key for WhatsApp routing and OTP login.',
    satisfiedBy: (p) => Boolean(p.phone?.trim()),
  },
  {
    field: 'idNumber',
    group: 'core_identity',
    severity: 'recommended',
    reason: 'ID/passport verification is optional at onboarding and required before paid credit purchase.',
    satisfiedBy: (p) => Boolean(p.idNumber?.trim()),
  },
  // ── Service offering ─────────────────────────────────────────────────────
  {
    field: 'skills',
    group: 'service_offering',
    severity: 'block_submit',
    reason: 'Skills drive matching to job categories.',
    satisfiedBy: (p) => Array.isArray(p.skills) && p.skills.length > 0,
  },
  {
    field: 'experience',
    group: 'service_offering',
    severity: 'block_customer_display',
    reason: 'Experience is shown on the customer shortlist card.',
    satisfiedBy: (p) => Boolean(p.experience?.trim()),
  },
  // ── Availability / coverage ──────────────────────────────────────────────
  {
    field: 'serviceAreas',
    group: 'availability_coverage',
    severity: 'block_submit',
    // G4: locationNodeIds (structured) satisfies this requirement in the same way
    // as legacy freetext serviceAreas. Both encode "where this provider operates"
    // and are used by the matching engine.
    reason: 'Service areas (or structured location nodes) drive matching to job locations.',
    satisfiedBy: (p) =>
      (Array.isArray(p.serviceAreas) && p.serviceAreas.length > 0) ||
      (Array.isArray(p.locationNodeIds) && p.locationNodeIds.length > 0),
  },
  {
    field: 'availability',
    group: 'availability_coverage',
    severity: 'block_submit',
    reason: 'Availability drives day-of-week matching.',
    satisfiedBy: (p) => Boolean(p.availability?.trim()),
  },
  // ── Pricing ──────────────────────────────────────────────────────────────
  {
    field: 'callOutFee',
    group: 'pricing',
    severity: 'block_customer_display',
    reason:
      'Call-out fee (labour rate, excluding materials) is shown on customer shortlist cards and used to sort/filter providers by budget.',
    satisfiedBy: (p) => p.callOutFee !== null && p.callOutFee !== undefined && Number(p.callOutFee) >= 0,
  },
  // ── Trust / verification ─────────────────────────────────────────────────
  // (verified, kycStatus live on Provider; surfaced separately by admin tooling.)
  // ── Customer-display fields ──────────────────────────────────────────────
  {
    field: 'avatarUrl',
    group: 'customer_display',
    severity: 'recommended',
    reason:
      'Profile photo improves customer trust on shortlist cards. Optional today (Phase 4b will add a dedicated WhatsApp onboarding step).',
    satisfiedBy: (p) => Boolean(p.avatarUrl?.trim() || p.profilePhotoAttachmentId?.trim()),
  },
]

export function evaluateProviderProfileCompleteness(profile: ProviderProfileLike): ProfileCompleteness {
  const missing: ProfileCompleteness['missing'] = []
  for (const req of FIELD_REQUIREMENTS) {
    if (!req.satisfiedBy(profile)) {
      missing.push({
        field: req.field as string,
        reason: req.reason,
        group: req.group,
        severity: req.severity,
      })
    }
  }
  const blockingSubmit = missing.some((m) => m.severity === 'block_submit')
  const blockingApprove = missing.some((m) => m.severity === 'block_submit' || m.severity === 'block_approve')
  const blockingCustomerDisplay = missing.some((m) => m.severity !== 'recommended')

  return {
    ok: missing.length === 0,
    canSubmit: !blockingSubmit,
    canApprove: !blockingApprove,
    canShowToCustomers: !blockingCustomerDisplay,
    missing,
  }
}

// Convenience: render a short list of missing-field reasons for a WhatsApp
// summary or admin dashboard. Returns an empty string when complete.
export function describeMissingFields(profile: ProviderProfileLike): string {
  const result = evaluateProviderProfileCompleteness(profile)
  if (result.ok) return ''
  return result.missing.map((m) => `• ${m.field} - ${m.reason}`).join('\n')
}
