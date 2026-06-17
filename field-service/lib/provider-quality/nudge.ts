// Provider Quality nudge — message generation, template selection, dedup.
//
// Operational guard rails this module enforces:
//   1. NUDGE_MAX_PER_DIMENSION outbound nudges per provider per dimension.
//   2. NUDGE_SPACING_DAYS minimum spacing between nudges of the same dimension.
//   3. Dry-run preview always available before any real send.
//   4. Nothing here calls WhatsApp; the caller (server action) does that AFTER
//      previewing. Keeps this module deterministic + unit-testable.

import type { ProviderQualitySnapshot, QualityDimension } from './quality'
import { QUALITY_DIMENSION_LABEL } from './quality'

export const NUDGE_MAX_PER_DIMENSION = 3
export const NUDGE_SPACING_DAYS = 7

/** Maps each missing dimension to the approved Meta template + body builder. */
export interface NudgeTemplateSpec {
  /** Template name registered in lib/messaging-templates.ts (and approved by Meta). */
  templateName: string
  /** Human-readable category for the audit log. */
  category: 'kyc' | 'profile_photo' | 'portfolio_evidence' | 'high_risk_cert' | 'multi'
  /**
   * Renders the body shown in the dry-run preview. For real sends, the params
   * are substituted into the Meta-approved template — the preview body is the
   * source of truth for what the recipient will see.
   */
  buildPreview(args: {
    firstName: string
    link: string
    missingItemsList?: string
  }): string
}

const TEMPLATES: Record<QualityDimension, NudgeTemplateSpec> = {
  kyc: {
    templateName: 'provider_kyc_nudge',
    category: 'kyc',
    buildPreview: ({ firstName, link }) =>
      `Hi ${firstName}, thanks for joining Plug A Pro.\n\nWe are improving the quality of providers on the platform before sending more customer requests.\n\nPlease complete your identity verification here: ${link}\n\nThis helps us confirm who is doing work through the platform and protects both customers and providers.`,
  },
  profile_photo: {
    templateName: 'provider_profile_photo_nudge',
    category: 'profile_photo',
    buildPreview: ({ firstName, link }) =>
      `Hi ${firstName}, thanks for joining Plug A Pro.\n\nPlease upload a clear profile photo so customers and our operations team can identify you properly.\n\nComplete it here: ${link}\n\nA complete profile gives you a better chance of being considered for work.`,
  },
  portfolio_evidence: {
    templateName: 'provider_evidence_nudge',
    category: 'portfolio_evidence',
    buildPreview: ({ firstName, link }) =>
      `Hi ${firstName}, thanks for joining Plug A Pro.\n\nBefore we send more customer requests, we need to see evidence of your previous work.\n\nPlease upload clear photos of completed jobs or supporting work examples here: ${link}\n\nThis helps us understand the quality of your workmanship.`,
  },
  high_risk_cert: {
    templateName: 'provider_high_risk_cert_nudge',
    category: 'high_risk_cert',
    buildPreview: ({ firstName, link }) =>
      `Hi ${firstName}, thanks for joining Plug A Pro.\n\nYou selected a service that requires extra proof because it can affect customer safety or property.\n\nPlease upload your certification, qualification, or strong supporting evidence here: ${link}\n\nThis is needed before we can confidently consider you for this type of work.`,
  },
}

const MULTI_TEMPLATE: NudgeTemplateSpec = {
  templateName: 'provider_quality_multi_nudge',
  category: 'multi',
  buildPreview: ({ firstName, link, missingItemsList }) =>
    `Hi ${firstName}, thanks for joining Plug A Pro.\n\nWe are improving provider quality before sending more customer requests.\n\nPlease complete the following on your profile:\n${missingItemsList ?? '- profile items'}\n\nYou can update your profile here: ${link}\n\nA complete profile helps us assess you properly and gives you a better chance of being considered for work.`,
}

export interface ProviderNudgeContext {
  firstName: string
  /** Pre-resolved per-dimension deep link. The caller knows the prod app URL + tokens. */
  links: Partial<Record<QualityDimension, string>>
  /** Fallback link for the multi-item template (profile dashboard). */
  profileLink: string
}

export interface ProviderNudgePlan {
  providerId: string
  dimension: QualityDimension | 'multi'
  templateName: string
  preview: string
  missingItems: QualityDimension[]
  /** Always supplied so the audit row carries the missing-item list as JSON. */
  metadata: {
    missingItems: QualityDimension[]
    dimension: QualityDimension | 'multi'
    category: NudgeTemplateSpec['category']
  }
}

/** Choose dimension to nudge: 1 missing → that dimension; 2+ → multi. */
export function pickNudgeDimension(snapshot: ProviderQualitySnapshot): QualityDimension | 'multi' | null {
  if (snapshot.missingItems.length === 0) return null
  if (snapshot.missingItems.length === 1) return snapshot.missingItems[0]
  return 'multi'
}

export function planNudgeForProvider(
  snapshot: ProviderQualitySnapshot,
  context: ProviderNudgeContext,
): ProviderNudgePlan | null {
  const dimension = pickNudgeDimension(snapshot)
  if (!dimension) return null

  if (dimension === 'multi') {
    const missingItemsList = snapshot.missingItems
      .map((dim) => `- ${QUALITY_DIMENSION_LABEL[dim]}`)
      .join('\n')
    return {
      providerId: snapshot.providerId,
      dimension: 'multi',
      templateName: MULTI_TEMPLATE.templateName,
      preview: MULTI_TEMPLATE.buildPreview({
        firstName: context.firstName,
        link: context.profileLink,
        missingItemsList,
      }),
      missingItems: snapshot.missingItems,
      metadata: {
        missingItems: snapshot.missingItems,
        dimension: 'multi',
        category: MULTI_TEMPLATE.category,
      },
    }
  }

  const tmpl = TEMPLATES[dimension]
  const link = context.links[dimension] ?? context.profileLink
  return {
    providerId: snapshot.providerId,
    dimension,
    templateName: tmpl.templateName,
    preview: tmpl.buildPreview({ firstName: context.firstName, link }),
    missingItems: [dimension],
    metadata: {
      missingItems: [dimension],
      dimension,
      category: tmpl.category,
    },
  }
}

/** Returns true if the provider has been nudged for this dimension recently. */
export function isRecentlyNudged(
  recent: Array<{ templateName: string; createdAt: Date; metadata?: unknown }>,
  templateName: string,
  spacingDays: number = NUDGE_SPACING_DAYS,
): boolean {
  const cutoff = new Date(Date.now() - spacingDays * 24 * 60 * 60 * 1000)
  return recent.some((e) => e.templateName === templateName && e.createdAt > cutoff)
}

export function countRecentNudges(
  recent: Array<{ templateName: string; createdAt: Date }>,
  templateName: string,
): number {
  return recent.filter((e) => e.templateName === templateName).length
}

/** Public bundle of constants so the admin UI can render the same strings. */
export const NUDGE_TEMPLATES: Record<QualityDimension | 'multi', NudgeTemplateSpec> = {
  ...TEMPLATES,
  multi: MULTI_TEMPLATE,
}
