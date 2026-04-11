export function getProviderMarketplaceReviewLabel(marketplaceApproved: boolean): string {
  return marketplaceApproved
    ? 'Application reviewed by Plug-A-Pro'
    : 'Provider-supplied profile'
}

export function getProviderMarketplaceReviewDescription(): string {
  return 'Skills, bio, service areas, experience, and similar profile details are supplied by the provider. Any evidence note or portfolio link is shared by the provider unless a field says Plug-A-Pro reviewed it. Plug-A-Pro records completed jobs, quotes, and customer reviews completed on the platform, but does not claim licensing, background checks, or workmanship guarantees unless a specific field says so.'
}

export type ProviderTrustProvenance =
  | 'provider-supplied'
  | 'provider-shared-evidence'
  | 'platform-recorded'
  | 'marketplace-review'

export type ProviderTrustSignal = {
  label: string
  value: string
  provenance: ProviderTrustProvenance
  description?: string
}

export function getProviderTrustProvenanceLabel(provenance: ProviderTrustProvenance): string {
  switch (provenance) {
    case 'provider-supplied':
      return 'Provider-supplied'
    case 'provider-shared-evidence':
      return 'Provider-shared evidence'
    case 'platform-recorded':
      return 'Platform-recorded'
    case 'marketplace-review':
      return 'Marketplace review'
  }
}

export function buildProviderTrustSignals(input: {
  marketplaceApproved: boolean
  skills?: string[]
  serviceAreas?: string[]
  experience?: string | null
  evidenceNote?: string | null
  completedJobs?: number
  reviewCount?: number
  averageRating?: number | null
}): ProviderTrustSignal[] {
  const signals: ProviderTrustSignal[] = []

  if (input.skills?.length) {
    signals.push({
      label: 'Skills',
      value: input.skills.join(', '),
      provenance: 'provider-supplied',
    })
  }

  if (input.serviceAreas?.length) {
    signals.push({
      label: 'Service areas',
      value: input.serviceAreas.join(', '),
      provenance: 'provider-supplied',
    })
  }

  if (input.experience) {
    signals.push({
      label: 'Experience',
      value: input.experience,
      provenance: 'provider-supplied',
    })
  }

  if (input.evidenceNote) {
    signals.push({
      label: 'Provider evidence note',
      value: input.evidenceNote,
      provenance: 'provider-shared-evidence',
      description: 'This is the provider’s own note about past work, references, or certificates unless Plug-A-Pro says a specific item was checked.',
    })
  }

  if (typeof input.completedJobs === 'number') {
    signals.push({
      label: 'Completed jobs on Plug-A-Pro',
      value: String(input.completedJobs),
      provenance: 'platform-recorded',
    })
  }

  if (typeof input.reviewCount === 'number') {
    signals.push({
      label: 'Customer reviews on Plug-A-Pro',
      value: String(input.reviewCount),
      provenance: 'platform-recorded',
    })
  }

  if (typeof input.averageRating === 'number') {
    signals.push({
      label: 'Average rating',
      value: `${input.averageRating.toFixed(1)} / 5`,
      provenance: 'platform-recorded',
    })
  }

  if (input.marketplaceApproved) {
    signals.push({
      label: 'Marketplace review',
      value: 'Application reviewed for lead eligibility',
      provenance: 'marketplace-review',
      description: 'This review allows the provider to receive marketplace leads. It is not a blanket licence, safety, or workmanship certification.',
    })
  }

  return signals
}
