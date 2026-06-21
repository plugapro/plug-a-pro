// ─── Provider Profile Coach Agent — pure evaluator ───────────────────────────
// Scores an existing provider profile on three axes (completeness, trust,
// customer attractiveness), produces improvement suggestions, and — when the
// provider is reachable and has concrete gaps — an OPTIONAL WhatsApp DRAFT for
// ops approval. Strong profiles return null (nothing to surface). Pure: no I/O.
//
// See outputs/ops-agent-workflow-team/PlugAPro-Ops-Agent-Workflow-Team.md (Agent B).

import {
  buildDedupeKey,
  type DraftMessageSpec,
  type Evaluation,
  type Evaluator,
  type RecommendedAction,
  type Signal,
} from '../../types'

const AGENT_KEY = 'PROVIDER_PROFILE_COACH' as const

export interface ProfileCandidate {
  id: string
  phone: string | null
  firstName?: string | null
  hasBio: boolean
  hasAvatar: boolean
  skillsCount: number
  serviceAreasCount: number
  hasExperience: boolean
  portfolioCount: number
  equipmentCount: number
  verified: boolean
  kycVerified: boolean
  payoutVerified: boolean
  averageRating: number // 0–5
  completedJobsCount: number
  reliabilityScore: number // 0–1
  acceptanceRate: number // 0–1
  complaintRate: number // 0–1
  whatsappMarketingOptIn: boolean
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

interface CompletenessItem {
  code: string
  label: string
  weight: number
  satisfied: (c: ProfileCandidate) => boolean
}

/** Completeness criteria. Weights sum to 100. */
export const COMPLETENESS_ITEMS: CompletenessItem[] = [
  { code: 'bio', label: 'Profile bio', weight: 20, satisfied: (c) => c.hasBio },
  { code: 'avatar', label: 'Profile photo', weight: 20, satisfied: (c) => c.hasAvatar },
  { code: 'experience', label: 'Experience summary', weight: 15, satisfied: (c) => c.hasExperience },
  { code: 'portfolio', label: 'Portfolio / work photos', weight: 15, satisfied: (c) => c.portfolioCount > 0 },
  { code: 'skills', label: 'Service categories', weight: 15, satisfied: (c) => c.skillsCount > 0 },
  { code: 'service_areas', label: 'Service areas', weight: 10, satisfied: (c) => c.serviceAreasCount > 0 },
  { code: 'equipment', label: 'Equipment tags', weight: 5, satisfied: (c) => c.equipmentCount > 0 },
]

export interface ProfileScores {
  completeness: number
  trust: number
  attractiveness: number
  /** Unsatisfied completeness items. */
  gaps: CompletenessItem[]
}

export function scoreProfile(c: ProfileCandidate): ProfileScores {
  let completeness = 0
  const gaps: CompletenessItem[] = []
  for (const item of COMPLETENESS_ITEMS) {
    if (item.satisfied(c)) completeness += item.weight
    else gaps.push(item)
  }

  const trust =
    (c.verified ? 30 : 0) +
    (c.kycVerified ? 25 : 0) +
    (c.payoutVerified ? 15 : 0) +
    (c.complaintRate <= 0.05 ? 15 : 0) +
    (c.reliabilityScore >= 0.7 ? 15 : 0)

  const attractiveness =
    (c.hasAvatar ? 20 : 0) +
    (Math.min(c.averageRating, 5) / 5) * 25 +
    (Math.min(c.completedJobsCount, 5) / 5) * 25 +
    (c.portfolioCount > 0 ? 15 : 0) +
    Math.min(Math.max(c.acceptanceRate, 0), 1) * 15

  return {
    completeness: clampPct(completeness),
    trust: clampPct(trust),
    attractiveness: clampPct(attractiveness),
    gaps,
  }
}

export const STRONG_COMPLETENESS = 85
export const STRONG_TRUST = 70
export const STRONG_ATTRACTIVENESS = 70

/** A profile with no meaningful room to improve — nothing to surface to ops. */
export function isStrongProfile(s: ProfileScores): boolean {
  return (
    s.completeness >= STRONG_COMPLETENESS &&
    s.trust >= STRONG_TRUST &&
    s.attractiveness >= STRONG_ATTRACTIVENESS
  )
}

function classify(s: ProfileScores): string {
  if (s.completeness < 50) return 'profile_low_completeness'
  if (s.completeness < STRONG_COMPLETENESS) return 'profile_incomplete'
  return 'profile_attractiveness_or_trust_gap'
}

function severityFor(s: ProfileScores): Evaluation['severity'] {
  if (s.completeness < 50 || s.trust < 50) return 'MEDIUM'
  return 'LOW'
}

/** Build human suggestions from gaps + low trust/attractiveness drivers. */
function buildSuggestions(c: ProfileCandidate, s: ProfileScores): string[] {
  const out = s.gaps.map((g) => `Add your ${g.label.toLowerCase()}`)
  if (!c.verified) out.push('Complete marketplace verification to raise trust')
  if (!c.kycVerified) out.push('Finish identity (KYC) verification')
  if (c.averageRating > 0 && c.averageRating < 4) out.push('Improve service quality to lift your rating')
  return out
}

function buildDraft(
  c: ProfileCandidate,
  suggestions: string[],
): DraftMessageSpec | undefined {
  // Only nudge reachable, opted-in providers, and only about concrete gaps.
  if (!c.phone || !c.whatsappMarketingOptIn || suggestions.length === 0) return undefined
  const greeting = c.firstName ? `Hi ${c.firstName}` : 'Hi there'
  const top = suggestions.slice(0, 3).map((sug) => `• ${sug}`).join('\n')
  const body =
    `${greeting}! A few quick tweaks will help you win more jobs on Plug A Pro:\n\n${top}\n\n` +
    `Want a hand updating your profile? Just reply here.`
  return {
    channel: 'WHATSAPP',
    recipientRole: 'PROVIDER',
    recipientPhone: c.phone,
    template: 'FREEFORM',
    freeformBody: body,
    rationale:
      'Profile coaching nudge highlighting the highest-impact gaps. Requires ops approval ' +
      'and an open WhatsApp session before sending.',
  }
}

export const evaluateProfile: Evaluator<ProfileCandidate> = (c) => {
  const s = scoreProfile(c)
  if (isStrongProfile(s)) return null // nothing to surface

  const classification = classify(s)
  const suggestions = buildSuggestions(c, s)

  const signals: Signal[] = [
    { code: 'completeness_score', label: 'Completeness score', weight: s.completeness },
    { code: 'trust_score', label: 'Trust score', weight: s.trust },
    { code: 'attractiveness_score', label: 'Customer attractiveness score', weight: s.attractiveness },
    ...s.gaps.map((g) => ({ code: `missing_${g.code}`, label: `Missing: ${g.label}`, weight: g.weight })),
  ]

  const actions: RecommendedAction[] = [
    { code: 'open_provider', label: 'Open provider', href: `/admin/providers/${c.id}` },
    { code: 'coach_provider', label: 'Send coaching nudge' },
  ]

  const summary =
    `Completeness ${s.completeness}, trust ${s.trust}, attractiveness ${s.attractiveness}. ` +
    (suggestions.length ? `Suggested: ${suggestions.slice(0, 3).join('; ')}.` : 'Minor gaps only.')

  return {
    agentKey: AGENT_KEY,
    entityType: 'PROVIDER',
    entityId: c.id,
    classification,
    score: s.completeness,
    severity: severityFor(s),
    signals,
    summary,
    recommendedActions: actions,
    draft: buildDraft(c, suggestions),
    dedupeKey: buildDedupeKey(AGENT_KEY, c.id, 'coach'),
  }
}

/** Pull the three axis scores back out of a stored Evaluation's signals. */
export function extractProfileScores(signals: Signal[]): {
  completeness: number
  trust: number
  attractiveness: number
} {
  const byCode = (code: string) => signals.find((s) => s.code === code)?.weight ?? 0
  return {
    completeness: byCode('completeness_score'),
    trust: byCode('trust_score'),
    attractiveness: byCode('attractiveness_score'),
  }
}
