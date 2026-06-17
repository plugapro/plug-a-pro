// Provider Quality — pure helpers that compute a per-provider quality snapshot
// from raw model rows. Used by:
//   - /admin/quality reporting
//   - lib/provider-quality/nudge.ts (message generation)
//   - scripts/provider-quality-report.ts (founder-facing baseline)
//
// Mirrors the high-risk classification in lib/service-category-policy.ts so
// the admin view and the matching engine cannot disagree on what "high risk"
// means.

import { getServiceComplianceRequirement } from '@/lib/service-category-policy'

/** What we measure per provider. Order matters — used by pickNudgeDimension. */
export const QUALITY_DIMENSIONS = [
  'kyc',
  'profile_photo',
  'portfolio_evidence',
  'high_risk_cert',
] as const

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number]

export const QUALITY_DIMENSION_LABEL: Record<QualityDimension, string> = {
  kyc: 'Identity verification',
  profile_photo: 'Profile photo',
  portfolio_evidence: 'Evidence of work',
  high_risk_cert: 'Certification for high-risk skill',
}

/** Stable order for surfacing the worst-blocked items first in the admin view. */
export const QUALITY_DIMENSION_PRIORITY: Record<QualityDimension, number> = {
  high_risk_cert: 0, // most blocking — safety/regulatory
  kyc: 1,
  portfolio_evidence: 2,
  profile_photo: 3,
}

/** Per-dimension status — granular enough to drive both the report and the nudge text. */
export type DimensionStatus =
  | 'PRESENT' // dimension is satisfied
  | 'MISSING' // not started
  | 'IN_PROGRESS' // started but not complete (KYC only today)
  | 'NEEDS_REVIEW' // submitted/evidence uploaded, awaiting decision
  | 'FAILED' // rejected / expired (KYC only today)
  | 'NOT_APPLICABLE' // dimension does not apply (e.g. cert when no high-risk skill)

/** Input shape — kept narrow so it can be hydrated from a single Prisma query. */
export interface ProviderQualityInput {
  id: string
  name: string | null
  firstName?: string | null
  phone: string | null
  active: boolean
  skills: string[]
  avatarUrl: string | null
  portfolioUrls: string[]
  kycStatus: string | null
  /** Status enum from technician_certifications + admin-added provider_certifications combined. */
  certifications: Array<{
    code?: string | null
    status?: string | null
    /** Set on admin-added provider_certifications when verified. */
    verifiedAt?: Date | null
    evidenceUrl?: string | null
  }>
}

export interface ProviderQualitySnapshot {
  providerId: string
  isQualityReady: boolean
  hasHighRiskSkill: boolean
  highRiskSkills: string[]
  dimensions: Record<QualityDimension, DimensionStatus>
  missingItems: QualityDimension[] // ordered by QUALITY_DIMENSION_PRIORITY
  recommendedNudge: QualityDimension | null
}

/** Tiny normaliser — categories in the policy file are lowercase. */
function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

/** Returns the high-risk + regulated subset of a provider's declared skills. */
export function getHighRiskSkills(skills: string[]): string[] {
  const seen = new Set<string>()
  for (const raw of skills) {
    const skill = normalizeSkill(raw)
    if (!skill || seen.has(skill)) continue
    const req = getServiceComplianceRequirement(skill)
    if (req.riskLevel === 'high_risk' || req.riskLevel === 'regulated') {
      seen.add(skill)
    }
  }
  return [...seen]
}

function classifyKyc(status: string | null | undefined): DimensionStatus {
  switch (status) {
    case 'VERIFIED':
      return 'PRESENT'
    case 'IN_PROGRESS':
      return 'IN_PROGRESS'
    case 'SUBMITTED':
      return 'NEEDS_REVIEW'
    case 'REJECTED':
    case 'EXPIRED':
      return 'FAILED'
    case 'NOT_STARTED':
    case null:
    case undefined:
      return 'MISSING'
    default:
      return 'MISSING' // forward-compatible default
  }
}

function classifyProfilePhoto(avatarUrl: string | null): DimensionStatus {
  return avatarUrl && avatarUrl.trim().length > 0 ? 'PRESENT' : 'MISSING'
}

function classifyPortfolio(portfolioUrls: string[]): DimensionStatus {
  return portfolioUrls.some((url) => url && url.trim().length > 0) ? 'PRESENT' : 'MISSING'
}

/** A cert that is uploaded but not yet reviewed counts as NEEDS_REVIEW. */
function classifyHighRiskCert(input: ProviderQualityInput, hasHighRisk: boolean): DimensionStatus {
  if (!hasHighRisk) return 'NOT_APPLICABLE'
  if (input.certifications.length === 0) return 'MISSING'
  const verified = input.certifications.some(
    (c) =>
      c.status === 'VERIFIED' ||
      c.status === 'REVIEWED' ||
      (c.verifiedAt != null && c.evidenceUrl != null),
  )
  if (verified) return 'PRESENT'
  const evidenceUploaded = input.certifications.some(
    (c) => c.status === 'EVIDENCE_UPLOADED' || (c.evidenceUrl != null && c.evidenceUrl.length > 0),
  )
  if (evidenceUploaded) return 'NEEDS_REVIEW'
  return 'MISSING' // SELF_DECLARED only — no evidence yet
}

/** A single dimension is "satisfied" only when fully PRESENT or NOT_APPLICABLE. */
export function isDimensionSatisfied(status: DimensionStatus): boolean {
  return status === 'PRESENT' || status === 'NOT_APPLICABLE'
}

export function computeProviderQuality(input: ProviderQualityInput): ProviderQualitySnapshot {
  const highRiskSkills = getHighRiskSkills(input.skills)
  const hasHighRiskSkill = highRiskSkills.length > 0

  const dimensions: Record<QualityDimension, DimensionStatus> = {
    kyc: classifyKyc(input.kycStatus),
    profile_photo: classifyProfilePhoto(input.avatarUrl),
    portfolio_evidence: classifyPortfolio(input.portfolioUrls),
    high_risk_cert: classifyHighRiskCert(input, hasHighRiskSkill),
  }

  const missingItems = (QUALITY_DIMENSIONS as readonly QualityDimension[])
    .filter((dim) => !isDimensionSatisfied(dimensions[dim]))
    .sort((a, b) => QUALITY_DIMENSION_PRIORITY[a] - QUALITY_DIMENSION_PRIORITY[b])

  const isQualityReady = input.active && missingItems.length === 0

  return {
    providerId: input.id,
    isQualityReady,
    hasHighRiskSkill,
    highRiskSkills,
    dimensions,
    missingItems,
    recommendedNudge: missingItems[0] ?? null,
  }
}

/** Aggregate counts used by the admin report header + scripts/provider-quality-report.ts. */
export interface ProviderQualityCounts {
  totalProviders: number
  active: number
  qualityReady: number
  // KYC
  kycVerified: number
  kycInProgress: number
  kycNeedsReview: number // SUBMITTED awaiting decision
  kycFailed: number // REJECTED + EXPIRED
  kycNotStarted: number
  // Profile + evidence
  withProfilePhoto: number
  missingProfilePhoto: number
  withPortfolioEvidence: number
  missingPortfolioEvidence: number
  // High-risk
  highRiskProviders: number
  highRiskMissingCert: number
  highRiskNeedsReview: number
  highRiskWithCert: number
}

export function aggregateQualityCounts(snapshots: ProviderQualitySnapshot[], activeFlags: Record<string, boolean>): ProviderQualityCounts {
  const c: ProviderQualityCounts = {
    totalProviders: snapshots.length,
    active: 0,
    qualityReady: 0,
    kycVerified: 0,
    kycInProgress: 0,
    kycNeedsReview: 0,
    kycFailed: 0,
    kycNotStarted: 0,
    withProfilePhoto: 0,
    missingProfilePhoto: 0,
    withPortfolioEvidence: 0,
    missingPortfolioEvidence: 0,
    highRiskProviders: 0,
    highRiskMissingCert: 0,
    highRiskNeedsReview: 0,
    highRiskWithCert: 0,
  }
  for (const s of snapshots) {
    if (activeFlags[s.providerId]) c.active++
    if (s.isQualityReady) c.qualityReady++
    switch (s.dimensions.kyc) {
      case 'PRESENT':
        c.kycVerified++
        break
      case 'IN_PROGRESS':
        c.kycInProgress++
        break
      case 'NEEDS_REVIEW':
        c.kycNeedsReview++
        break
      case 'FAILED':
        c.kycFailed++
        break
      case 'MISSING':
        c.kycNotStarted++
        break
    }
    if (s.dimensions.profile_photo === 'PRESENT') c.withProfilePhoto++
    else c.missingProfilePhoto++
    if (s.dimensions.portfolio_evidence === 'PRESENT') c.withPortfolioEvidence++
    else c.missingPortfolioEvidence++
    if (s.hasHighRiskSkill) {
      c.highRiskProviders++
      switch (s.dimensions.high_risk_cert) {
        case 'PRESENT':
          c.highRiskWithCert++
          break
        case 'NEEDS_REVIEW':
          c.highRiskNeedsReview++
          break
        case 'MISSING':
          c.highRiskMissingCert++
          break
      }
    }
  }
  return c
}
