/**
 * Plug-A-Pro AI operating loop — improvement candidate generator (learning layer).
 *
 * Turns *repeated* safe operational signal into reviewable improvement
 * candidates. It never produces code, never applies a change, and never decides
 * anything that touches production. Each candidate is a structured brief plus a
 * draft Claude Code task instruction for a human to approve and dispatch.
 *
 * Noise controls (deliberate):
 *  - only events that are improvementCandidateEligible in the taxonomy count;
 *  - a per-rule minimum evidence threshold (default 3) — one-offs are ignored;
 *  - candidates with no safe example reference are dropped (no vague candidates);
 *  - grouping is by (event, flow) so distinct flows stay distinct.
 */

import { hashIdentifier } from './redaction'
import { getEventDefinition, type EventCategory } from './taxonomy'
import { areaForFlow, classifyChangeRisk } from './human-review-policy'
import type {
  CandidateOwnerRole,
  CandidateRiskLevel,
  ImprovementCandidate,
  ObservationRecord,
} from './types'
import type { AiLoopSink } from './sink'

/** Minimal evidence shape the generator needs. ObservationRecords satisfy it via the adapter. */
export interface CandidateEvidenceEvent {
  name: string
  affectedFlow?: string | null
  entityRefs?: Record<string, string>
}

interface CandidateRule {
  eventName: string
  minEvidence: number
  category: EventCategory
  defaultFlow: string
  title: (count: number, flow: string) => string
  problem: (count: number, flow: string) => string
  suspectedCause: string | null
  suggestedInvestigation: string
  recommendedOwnerRole: CandidateOwnerRole
  /** When set, overrides the flow-derived risk (e.g. force critical). */
  riskOverride?: CandidateRiskLevel
}

const RULES: Record<string, CandidateRule> = {
  'booking.failed': {
    eventName: 'booking.failed',
    minEvidence: 3,
    category: 'booking',
    defaultFlow: 'booking',
    title: (n) => `Repeated booking failures (${n} occurrences)`,
    problem: (n, flow) =>
      `Bookings are failing repeatedly in the ${flow} flow (${n} captured occurrences). Customers who reach the point of booking are being blocked, which is high up the value funnel.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Group booking.failed observations by error code and slot/provider. Reproduce the most common failure code against a seeded booking. Check slot availability, provider acceptance lock, and the booking state machine.',
    recommendedOwnerRole: 'ENGINEERING',
  },
  'payment.failed': {
    eventName: 'payment.failed',
    minEvidence: 3,
    category: 'payment',
    defaultFlow: 'payment',
    title: (n) => `Repeated payment failures (${n} occurrences)`,
    problem: (n, flow) =>
      `Payments are failing repeatedly in the ${flow} flow (${n} captured occurrences). This directly blocks revenue and provider unlocks.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Correlate payment.failed observations with the PSP (Peach/PayAt/PayFast) and failure code. Check the request/response contract and ITN/callback handling. Do NOT change payment logic without explicit human approval.',
    recommendedOwnerRole: 'FINANCE',
    riskOverride: 'critical',
  },
  'kyc.document_upload_failed': {
    eventName: 'kyc.document_upload_failed',
    minEvidence: 3,
    category: 'kyc',
    defaultFlow: 'kyc',
    title: (n) => `Repeated KYC document upload failures (${n} occurrences)`,
    problem: (n, flow) =>
      `Provider KYC document uploads are failing repeatedly (${n} captured occurrences) in the ${flow} flow, stalling provider onboarding and verification.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Inspect upload failures by file type/size and storage target. Check blob storage limits, content-type handling, and the verification vendor handoff. No document contents are captured — investigate from metadata only.',
    recommendedOwnerRole: 'TRUST',
    riskOverride: 'critical',
  },
  'whatsapp.message_delivery_failed': {
    eventName: 'whatsapp.message_delivery_failed',
    minEvidence: 3,
    category: 'whatsapp',
    defaultFlow: 'whatsapp',
    title: (n) => `Repeated WhatsApp delivery failures (${n} occurrences)`,
    problem: (n, flow) =>
      `Outbound WhatsApp messages are failing to deliver (${n} captured occurrences). WhatsApp is a primary customer channel, so delivery loss degrades the whole journey.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Group delivery failures by template name and failure reason. Check Meta template approval status, the 24h session window, and rate limits. No message bodies are captured.',
    recommendedOwnerRole: 'OPS',
  },
  'matching.no_providers': {
    eventName: 'matching.no_providers',
    minEvidence: 3,
    category: 'matching',
    defaultFlow: 'matching',
    title: (n) => `Matching returns no providers (${n} occurrences)`,
    problem: (n, flow) =>
      `Customer requests are reaching matching but finding no suitable providers (${n} captured occurrences) in the ${flow} flow. This is unmet demand and a supply or matching-rule gap.`,
    suspectedCause: 'Possible coverage gap (category × service area) or over-tight matching filters.',
    suggestedInvestigation:
      'Break down no-provider requests by category and service area. Compare against active provider coverage. Decide whether this is a supply problem (acquisition) or a matching-rule problem (engineering).',
    recommendedOwnerRole: 'OPS',
  },
  'matching.provider_accepted_no_response': {
    eventName: 'matching.provider_accepted_no_response',
    minEvidence: 3,
    category: 'matching',
    defaultFlow: 'matching',
    title: (n) => `Providers accept then go silent (${n} occurrences)`,
    problem: (n, flow) =>
      `Providers are accepting leads but not responding to the customer afterwards (${n} captured occurrences). This erodes customer trust after the hardest conversion step.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Identify affected providers from references and measure time-to-first-contact after acceptance. Consider an automated nudge and a trust/SLA signal. Provider activation/deactivation must stay human-gated.',
    recommendedOwnerRole: 'TRUST',
  },
  'quote.approval_abandoned': {
    eventName: 'quote.approval_abandoned',
    minEvidence: 5,
    category: 'quote',
    defaultFlow: 'quote',
    title: (n) => `Customers abandon quote approval (${n} occurrences)`,
    problem: (n, flow) =>
      `Customers are opening quote approvals but not completing them (${n} captured occurrences) in the ${flow} flow. Friction here loses already-warm demand.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Review the quote approval screen/flow for friction (clarity of price, CTA, auth gating). Check whether abandonment clusters on a step. This is largely product/UX, not high-risk.',
    recommendedOwnerRole: 'PRODUCT',
  },
  'admin_action.manual_workaround': {
    eventName: 'admin_action.manual_workaround',
    minEvidence: 3,
    category: 'admin_action',
    defaultFlow: 'admin_action',
    title: (n) => `Admins repeat a manual workaround (${n} occurrences)`,
    problem: (n, flow) =>
      `Admins are repeatedly performing the same manual workaround (${n} captured occurrences). Recurring manual work is a strong signal for a missing product capability.`,
    suspectedCause: 'A product gap is being papered over by manual ops effort.',
    suggestedInvestigation:
      'Identify the workaround from references/metadata and quantify time spent. Scope a self-serve or automated capability to replace it. Confirm it does not touch payment/KYC/security logic.',
    recommendedOwnerRole: 'PRODUCT',
  },
  'auth.state_inconsistent': {
    eventName: 'auth.state_inconsistent',
    minEvidence: 2,
    category: 'auth',
    defaultFlow: 'auth',
    title: (n) => `Auth state inconsistent across surfaces (${n} occurrences)`,
    problem: (n, flow) =>
      `Session/identity is disagreeing across mobile/PWA surfaces (${n} captured occurrences). Auth inconsistency is both a UX and a security concern.`,
    suspectedCause: 'Cookie/session clearing or cross-tab refresh drift between sign-in/out paths.',
    suggestedInvestigation:
      'Trace the affected surfaces and reproduce the inconsistency. Verify cookie clearing and cross-tab refresh. Any auth/RBAC change is high-risk and requires human review.',
    recommendedOwnerRole: 'SECURITY',
    riskOverride: 'critical',
  },
  'system_error.legal_link_broken': {
    eventName: 'system_error.legal_link_broken',
    minEvidence: 2,
    category: 'system_error',
    defaultFlow: 'privacy_legal',
    title: (n) => `Broken privacy/terms link (${n} occurrences)`,
    problem: (n) =>
      `A privacy/terms/legal link is erroring or 404ing (${n} captured occurrences). Broken legal links are a POPIA/compliance exposure as well as a trust issue.`,
    suspectedCause: 'A moved or unpublished legal page, or a stale link in metadata/footer.',
    suggestedInvestigation:
      'Identify the broken route(s) and the correct destination. Fix the link and add a check. POPIA/privacy-impacting changes require human review.',
    recommendedOwnerRole: 'PRODUCT',
  },
  'system_error.frontend_high_severity': {
    eventName: 'system_error.frontend_high_severity',
    minEvidence: 3,
    category: 'system_error',
    defaultFlow: 'frontend',
    title: (n) => `Recurring high-severity frontend error (${n} occurrences)`,
    problem: (n, flow) =>
      `A high-severity frontend error is recurring (${n} captured occurrences) in the ${flow} flow, likely breaking a user journey.`,
    suspectedCause: null,
    suggestedInvestigation:
      'Group by error signature/route from Sentry and the captured metadata. Reproduce on the affected route and add a regression test. No raw error payloads are captured.',
    recommendedOwnerRole: 'ENGINEERING',
  },
}

export interface GenerateOptions {
  now?: () => string
  /** Global floor applied on top of each rule's own threshold. */
  minEvidence?: number
  /** Max safe references included per candidate. */
  maxExampleRefs?: number
}

const RISK_ORDER: Record<CandidateRiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

function buildDraftTaskInstruction(c: Omit<ImprovementCandidate, 'draftTaskInstruction'>): string {
  const banner = c.humanReviewRequired
    ? '⚠️ HUMAN REVIEW REQUIRED before any merge or deploy. This area is gated.'
    : 'Lower-risk change. Still requires a human owner to approve the PR.'
  const refs = c.exampleRefs.length ? c.exampleRefs.join(', ') : '(none)'
  return [
    `Title: ${c.title}`,
    '',
    banner,
    '',
    `Problem: ${c.problemSummary}`,
    '',
    `Affected flow: ${c.affectedFlow} | Category: ${c.category} | Risk: ${c.riskLevel}`,
    `Evidence count: ${c.evidenceCount} | Safe references: ${refs}`,
    '',
    'Investigate first, then propose a fix:',
    c.suggestedInvestigation,
    '',
    'Guardrails (non-negotiable):',
    '- Do NOT deploy to production. Open a PR for human review.',
    '- Do NOT change payment, KYC, auth/RBAC, or security logic, run DB migrations,',
    '  delete data, alter voucher/credit balances, issue refunds, or send bulk',
    '  WhatsApp campaigns without explicit human approval.',
    '- Add tests that prove the fix and guard against regression.',
    '- Keep raw PII out of logs and OpenBrain; use references and safe summaries.',
    `Recommended owner: ${c.recommendedOwnerRole}.`,
  ].join('\n')
}

/**
 * Generate reviewable improvement candidates from a window of evidence events.
 * Pure and deterministic given a fixed `now`.
 */
export function generateImprovementCandidates(
  events: CandidateEvidenceEvent[],
  options: GenerateOptions = {},
): ImprovementCandidate[] {
  const now = options.now ?? (() => new Date().toISOString())
  const globalFloor = options.minEvidence ?? 0
  const maxRefs = options.maxExampleRefs ?? 5

  // group key = event + flow
  const groups = new Map<string, { rule: CandidateRule; flow: string; events: CandidateEvidenceEvent[] }>()

  for (const e of events) {
    const rule = RULES[e.name]
    if (!rule) continue
    const def = getEventDefinition(e.name)
    if (!def || !def.improvementCandidateEligible) continue
    const flow = (e.affectedFlow && e.affectedFlow.trim()) || rule.defaultFlow
    const key = `${e.name}::${flow}`
    const bucket = groups.get(key)
    if (bucket) bucket.events.push(e)
    else groups.set(key, { rule, flow, events: [e] })
  }

  const candidates: ImprovementCandidate[] = []

  for (const { rule, flow, events: group } of groups.values()) {
    const threshold = Math.max(rule.minEvidence, globalFloor)
    if (group.length < threshold) continue

    // Collect safe references; drop the candidate if there is no evidence at all.
    const refSet = new Set<string>()
    for (const e of group) {
      for (const [k, v] of Object.entries(e.entityRefs ?? {})) {
        if (v) refSet.add(`${k}=${v}`)
        if (refSet.size >= maxRefs) break
      }
      if (refSet.size >= maxRefs) break
    }
    const exampleRefs = [...refSet]
    if (exampleRefs.length === 0) continue // no vague, evidence-free candidates

    const area = areaForFlow(flow)
    const classification = classifyChangeRisk(area)
    const riskLevel = rule.riskOverride ?? classification.riskLevel

    const base: Omit<ImprovementCandidate, 'draftTaskInstruction'> = {
      id: `cand_${hashIdentifier(`${rule.eventName}|${flow}`)}`,
      title: rule.title(group.length, flow),
      problemSummary: rule.problem(group.length, flow),
      affectedFlow: flow,
      category: rule.category,
      evidenceCount: group.length,
      exampleRefs,
      suspectedCause: rule.suspectedCause,
      suggestedInvestigation: rule.suggestedInvestigation,
      riskLevel,
      recommendedOwnerRole: rule.recommendedOwnerRole,
      humanReviewRequired: classification.humanReviewRequired,
      createdAt: now(),
      status: 'new',
    }

    candidates.push({ ...base, draftTaskInstruction: buildDraftTaskInstruction(base) })
  }

  candidates.sort((a, b) => {
    const r = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel]
    return r !== 0 ? r : b.evidenceCount - a.evidenceCount
  })

  return candidates
}

/** Adapter: turn persisted observations into evidence for the generator. */
export function observationsToEvidence(observations: ObservationRecord[]): CandidateEvidenceEvent[] {
  return observations.map((o) => ({
    name: o.event,
    affectedFlow: o.affectedFlow,
    entityRefs: o.entityRefs,
  }))
}

/**
 * Persist candidates via a sink, degrading safely. Returns how many were
 * written. Never throws — a storage failure must not break a reporting job.
 */
export async function persistImprovementCandidates(
  candidates: ImprovementCandidate[],
  sink: AiLoopSink,
): Promise<number> {
  let written = 0
  for (const c of candidates) {
    try {
      await sink.writeCandidate(c)
      written += 1
    } catch (err) {
      console.warn('[ai-loop] candidate sink write failed (non-fatal)', {
        candidate: c.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return written
}
