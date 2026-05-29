// ─── Provider Application Review Guards ──────────────────────────────────────
//
// Centralised guard helpers used by both the admin UI (page.tsx server actions)
// and the auto-approval worker (provider-auto-approve.ts) to decide whether an
// application requires manual intervention before it can be approved.
//
// These are pure functions with no I/O - safe to unit-test without Prisma.

import {
  getServiceComplianceRequirement,
  hasAutoApprovalBlockingServiceSelection,
  type ServiceComplianceRequirement,
  type ServiceRiskLevel,
} from './service-category-policy'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApplicationForReviewGuard = {
  id: string
  skills: string[]
  /** Human-readable status string - used for undo-approval guard. */
  status: string
  /** Provider record linked to this application, if already created. */
  providerId?: string | null
}

export type ReviewRequirement = {
  categorySlug: string
  riskLevel: ServiceRiskLevel
  evidencePrompt: string
  certificationRequiredForApproval: boolean
  compliance: ServiceComplianceRequirement
}

export type ManualReviewResult = {
  /** Whether manual review is required before approval can proceed. */
  required: boolean
  /**
   * Structured list of category-level requirements that triggered the flag.
   * Empty when `required` is false.
   */
  requirements: ReviewRequirement[]
  /**
   * Short reason codes suitable for logging or UI display.
   * Mirrors the reason codes used by assessProviderApplicationForOpsReview().
   */
  reasonCodes: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the category (slug or label) is classified as high-risk or
 * regulated by SERVICE_COMPLIANCE_REQUIREMENTS and has blocksAutoApproval: true.
 *
 * Example high-risk categories: electrical, pest_control, air_conditioning, roofing.
 */
export function isHighRiskCategory(category: string): boolean {
  const req = getServiceComplianceRequirement(category)
  return Boolean(req.blocksAutoApproval)
}

/**
 * Evaluates whether a provider application requires manual admin review before
 * approval can proceed.
 *
 * Manual review is required when any skill maps to a category with
 * `blocksAutoApproval: true` in SERVICE_COMPLIANCE_REQUIREMENTS.
 *
 * @returns ManualReviewResult with structured reason codes and per-category detail.
 */
export function requiresManualReview(
  application: ApplicationForReviewGuard,
): ManualReviewResult {
  if (application.skills.length === 0) {
    return { required: false, requirements: [], reasonCodes: [] }
  }

  const requirements: ReviewRequirement[] = []
  const seen = new Set<string>()

  for (const skill of application.skills) {
    const compliance = getServiceComplianceRequirement(skill)
    if (!compliance.blocksAutoApproval || seen.has(compliance.serviceKey)) continue
    seen.add(compliance.serviceKey)
    requirements.push({
      categorySlug: compliance.serviceKey,
      riskLevel: compliance.riskLevel,
      evidencePrompt: compliance.evidencePrompt,
      certificationRequiredForApproval: Boolean(compliance.certificationRequiredForApproval),
      compliance,
    })
  }

  const required = requirements.length > 0
  const reasonCodes = required ? ['HIGH_RISK_CATEGORY'] : []

  return { required, requirements, reasonCodes }
}

/**
 * Returns true when an application has at least one auto-approval-blocking
 * category. Convenience wrapper over requiresManualReview() for boolean checks.
 */
export function applicationBlocksAutoApproval(
  application: Pick<ApplicationForReviewGuard, 'skills'>,
): boolean {
  return hasAutoApprovalBlockingServiceSelection(application.skills)
}

/**
 * Guard that prevents an already-approved application from being re-approved
 * or having its status changed without an explicit revocation path.
 *
 * Returns true (blocked) when the application is already in a terminal state
 * (APPROVED, REJECTED, CANCELLED) that should not be altered by a simple
 * re-approve action.
 *
 * Callers that need to reinstate an APPROVED provider must go through the
 * suspension/reinstatement path on the Provider record instead.
 */
export function isApprovalUndoBlocked(application: ApplicationForReviewGuard): boolean {
  return application.status === 'APPROVED'
}

/**
 * Returns a short human-readable summary of why manual review is required for
 * an application. Designed for admin UI tooltips and WhatsApp notifications.
 *
 * Returns null when no manual review is required.
 */
export function buildManualReviewSummary(
  application: ApplicationForReviewGuard,
): string | null {
  const result = requiresManualReview(application)
  if (!result.required) return null

  const categories = result.requirements.map((r) => r.compliance.label).join(', ')
  return `Manual review required for: ${categories}. Please verify relevant certifications or evidence before approving.`
}
