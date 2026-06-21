// ─── Provider Application Review Agent — pure evaluator ──────────────────────
// Given a minimised projection of a submitted ProviderApplication, score profile
// completeness across 9 weighted criteria, classify the application into one of
// five buckets, and produce an internal summary, a missing-information list,
// recommended ops actions, and (when the profile has gaps) a WhatsApp DRAFT for
// the provider. It performs NO I/O and never sends anything.
//
// See outputs/ops-agent-workflow-team/PlugAPro-Ops-Agent-Workflow-Team.md (Agent A).

import {
  buildDedupeKey,
  type DraftMessageSpec,
  type Evaluation,
  type Evaluator,
  type RecommendedAction,
  type Signal,
} from '../../types'

const AGENT_KEY = 'PROVIDER_APPLICATION_REVIEW' as const

/** Minimised projection the loader builds from a ProviderApplication. No raw PII beyond phone (draft only). */
export interface ApplicationCandidate {
  id: string
  hasName: boolean
  hasContact: boolean // phone and/or alternate present
  /** E.164 phone for the draft recipient. Used only by the runner's policy gate; never logged raw. */
  phone: string | null
  categoryCount: number
  serviceAreaCount: number
  /** Trimmed length of the business description / evidence note. */
  descriptionLength: number
  portfolioCount: number // evidence/work photo file count
  hasAvailability: boolean
  hasExperience: boolean
  hasIdNumber: boolean // verification document present (boolean only — never the value)
  hasRateInfo: boolean // call-out fee or hourly rate captured
  /** null = unknown / no areas given; false = areas given but none in the pilot footprint. */
  inPilotArea: boolean | null
  /** Loader flags likely duplicate/suspicious (phone or id matches an existing record). */
  duplicateSignal: boolean
  /** First name for a friendlier draft greeting. Optional. */
  firstName?: string | null
}

export type ApplicationClassification =
  | 'ready_for_ops_review'
  | 'needs_more_information'
  | 'high_potential_but_incomplete'
  | 'duplicate_or_suspicious'
  | 'unsuitable_for_current_pilot_area'

interface Criterion {
  code: string
  label: string
  weight: number
  satisfied: (c: ApplicationCandidate) => boolean
}

/** The 9 weighted criteria. Weights sum to 100. */
export const APPLICATION_CRITERIA: Criterion[] = [
  { code: 'identity_contact', label: 'Identity & contact details', weight: 15, satisfied: (c) => c.hasName && c.hasContact },
  { code: 'service_categories', label: 'Service categories', weight: 15, satisfied: (c) => c.categoryCount > 0 },
  { code: 'portfolio_photos', label: 'Portfolio / work photos', weight: 15, satisfied: (c) => c.portfolioCount > 0 },
  { code: 'service_area', label: 'Service area', weight: 10, satisfied: (c) => c.serviceAreaCount > 0 },
  { code: 'business_description', label: 'Business description', weight: 10, satisfied: (c) => c.descriptionLength >= 20 },
  { code: 'availability', label: 'Availability', weight: 10, satisfied: (c) => c.hasAvailability },
  { code: 'experience', label: 'Experience / certifications', weight: 10, satisfied: (c) => c.hasExperience },
  { code: 'verification_documents', label: 'Verification documents', weight: 10, satisfied: (c) => c.hasIdNumber },
  { code: 'payment_readiness', label: 'Payment readiness (rates)', weight: 5, satisfied: (c) => c.hasRateInfo },
]

export interface ScoredApplication {
  score: number
  /** Criteria the application does NOT satisfy. */
  gaps: Criterion[]
}

/** Sum the weights of satisfied criteria (0–100) and collect the gaps. */
export function scoreApplication(c: ApplicationCandidate): ScoredApplication {
  let score = 0
  const gaps: Criterion[] = []
  for (const crit of APPLICATION_CRITERIA) {
    if (crit.satisfied(c)) score += crit.weight
    else gaps.push(crit)
  }
  return { score, gaps }
}

export const READY_THRESHOLD = 80
export const POTENTIAL_THRESHOLD = 50

/** Decide the classification bucket. Suspicious and out-of-area take precedence over score. */
export function classifyApplication(
  c: ApplicationCandidate,
  score: number,
): ApplicationClassification {
  if (c.duplicateSignal) return 'duplicate_or_suspicious'
  if (c.serviceAreaCount > 0 && c.inPilotArea === false) {
    return 'unsuitable_for_current_pilot_area'
  }
  if (score >= READY_THRESHOLD) return 'ready_for_ops_review'
  if (score >= POTENTIAL_THRESHOLD) return 'high_potential_but_incomplete'
  return 'needs_more_information'
}

function severityFor(classification: ApplicationClassification): Evaluation['severity'] {
  switch (classification) {
    case 'duplicate_or_suspicious':
      return 'HIGH'
    case 'high_potential_but_incomplete':
    case 'needs_more_information':
      return 'MEDIUM'
    case 'unsuitable_for_current_pilot_area':
      return 'LOW'
    case 'ready_for_ops_review':
      return 'INFO'
  }
}

function buildActions(classification: ApplicationClassification): RecommendedAction[] {
  const actions: RecommendedAction[] = [
    { code: 'open_application', label: 'Open application', href: '/admin/applications' },
  ]
  switch (classification) {
    case 'ready_for_ops_review':
      actions.push({ code: 'approve_application', label: 'Proceed to approval' })
      break
    case 'high_potential_but_incomplete':
    case 'needs_more_information':
      actions.push({ code: 'request_more_info', label: 'Request missing info from provider' })
      break
    case 'duplicate_or_suspicious':
      actions.push({ code: 'review_duplicate', label: 'Check for duplicate / suspicious signals' })
      break
    case 'unsuitable_for_current_pilot_area':
      actions.push({ code: 'waitlist_out_of_area', label: 'Add to out-of-area waitlist' })
      break
  }
  return actions
}

function buildSummary(
  c: ApplicationCandidate,
  classification: ApplicationClassification,
  score: number,
  missingItems: string[],
): string {
  const head = `Application scored ${score}/100 → ${classification.replace(/_/g, ' ')}.`
  if (classification === 'duplicate_or_suspicious') {
    return `${head} Phone or ID matches an existing record — verify before any approval.`
  }
  if (classification === 'unsuitable_for_current_pilot_area') {
    return `${head} Service area falls outside the West Rand pilot footprint.`
  }
  if (missingItems.length === 0) {
    return `${head} Profile is complete; ready for ops to review.`
  }
  return `${head} Missing: ${missingItems.join(', ')}.`
}

/** Compose a polite freeform draft asking the provider to complete the missing items. */
function buildDraft(
  c: ApplicationCandidate,
  missingItems: string[],
): DraftMessageSpec | undefined {
  if (!c.phone || missingItems.length === 0) return undefined
  const greeting = c.firstName ? `Hi ${c.firstName}` : 'Hi there'
  const items = missingItems.map((m) => `• ${m}`).join('\n')
  const body =
    `${greeting}, thanks for applying to Plug A Pro! 🙌\n\n` +
    `To finish setting up your profile so we can start sending you jobs, we still need:\n${items}\n\n` +
    `Reply here and we'll help you complete it.`
  return {
    channel: 'WHATSAPP',
    recipientRole: 'PROVIDER',
    recipientPhone: c.phone,
    template: 'FREEFORM',
    freeformBody: body,
    rationale:
      'Application is incomplete; this draft asks the provider for the missing items. ' +
      'Requires ops approval and an open WhatsApp session before sending.',
  }
}

/** The pure evaluator. Every PENDING application yields exactly one Evaluation. */
export const evaluateApplication: Evaluator<ApplicationCandidate> = (c) => {
  const { score, gaps } = scoreApplication(c)
  const classification = classifyApplication(c, score)
  const missingItems = gaps.map((g) => g.label)

  const signals: Signal[] = gaps.map((g) => ({
    code: `missing_${g.code}`,
    label: `Missing: ${g.label}`,
    weight: g.weight,
  }))
  if (classification === 'duplicate_or_suspicious') {
    signals.unshift({ code: 'duplicate_signal', label: 'Possible duplicate / suspicious application', weight: 100 })
  }
  if (c.serviceAreaCount > 0 && c.inPilotArea === false) {
    signals.unshift({ code: 'outside_pilot_area', label: 'Service area outside the pilot footprint', weight: 80 })
  }

  // Only nudge the provider when the recommendation is to chase missing info.
  const draft =
    classification === 'needs_more_information' || classification === 'high_potential_but_incomplete'
      ? buildDraft(c, missingItems)
      : undefined

  return {
    agentKey: AGENT_KEY,
    entityType: 'PROVIDER_APPLICATION',
    entityId: c.id,
    classification,
    score,
    severity: severityFor(classification),
    signals,
    summary: buildSummary(c, classification, score, missingItems),
    recommendedActions: buildActions(classification),
    draft,
    dedupeKey: buildDedupeKey(AGENT_KEY, c.id, 'review'),
  }
}
