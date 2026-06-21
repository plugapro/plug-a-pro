/**
 * Plug-A-Pro AI operating loop — event taxonomy.
 *
 * A typed, stable vocabulary for the operational events the platform emits into
 * the AI operating loop (the "sensor layer"). Every event the loop understands
 * has a definition here. Definitions are intentionally declarative: they say
 * what a sensor MAY do, not what it must.
 *
 * This taxonomy is for the *learning* loop (OpenBrain observations + improvement
 * candidates). It is NOT the audit log (lib/audit.ts) and NOT the application
 * error store (lib/application-error-service.ts) — those remain the systems of
 * record. The AI loop sits downstream and only ever sees safe, derived signal.
 *
 * Nothing here writes anything. See openbrain-writer.ts for persistence.
 */

export const EVENT_CATEGORIES = [
  'auth',
  'customer_request',
  'service_search',
  'matching',
  'quote',
  'booking',
  'payment',
  'voucher',
  'provider_onboarding',
  'kyc',
  'whatsapp',
  'notification',
  'job_execution',
  'admin_action',
  'security',
  'system_error',
  'campaign',
  'support',
  'improvement_candidate',
  'workflow',
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const EVENT_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const
export type EventSeverity = (typeof EVENT_SEVERITIES)[number]

export const ACTOR_TYPES = ['customer', 'provider', 'admin', 'system', 'anonymous'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

/**
 * How aggressively the writer sanitises an event before it leaves the process.
 * - standard: mask phones, redact known sensitive keys, truncate free text.
 * - strict:   standard + treat unexpected free-text values as message bodies.
 * - aggregate: counts/derived numbers only; entity references are dropped.
 */
export const REDACTION_PROFILES = ['standard', 'strict', 'aggregate'] as const
export type RedactionProfile = (typeof REDACTION_PROFILES)[number]

export interface EventDefinition {
  /** Stable, dot-namespaced name. Never renamed once shipped. */
  name: string
  category: EventCategory
  defaultSeverity: EventSeverity
  /** Actor types that can legitimately produce this event. */
  actorTypes: ActorType[]
  /** Whether this event may become an OpenBrain observation. */
  openBrainEligible: boolean
  /** Whether repeats of this event may seed an improvement candidate. */
  improvementCandidateEligible: boolean
  redactionProfile: RedactionProfile
  description: string
}

function def(d: EventDefinition): EventDefinition {
  return d
}

/**
 * The registry. Representative, not exhaustive — the smallest set that covers
 * each category and every improvement-candidate rule in improvement-candidates.ts.
 * Add events here as sensors are wired in; never silently rename an existing one.
 */
export const EVENT_DEFINITIONS: Record<string, EventDefinition> = {
  // ── auth ──────────────────────────────────────────────────────────────────
  'auth.otp_verification_failed': def({
    name: 'auth.otp_verification_failed',
    category: 'auth',
    defaultSeverity: 'low',
    actorTypes: ['customer', 'provider', 'anonymous'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'An OTP verification attempt failed.',
  }),
  'auth.state_inconsistent': def({
    name: 'auth.state_inconsistent',
    category: 'auth',
    defaultSeverity: 'high',
    actorTypes: ['customer', 'provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'Session/identity disagreed across mobile/PWA surfaces.',
  }),

  // ── customer_request ────────────────────────────────────────────────────────
  'customer_request.submitted': def({
    name: 'customer_request.submitted',
    category: 'customer_request',
    defaultSeverity: 'info',
    actorTypes: ['customer', 'anonymous'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A customer service request was submitted.',
  }),
  'customer_request.submission_failed': def({
    name: 'customer_request.submission_failed',
    category: 'customer_request',
    defaultSeverity: 'medium',
    actorTypes: ['customer', 'anonymous'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'A customer service request failed to submit.',
  }),

  // ── service_search ───────────────────────────────────────────────────────────
  'service_search.no_results': def({
    name: 'service_search.no_results',
    category: 'service_search',
    defaultSeverity: 'low',
    actorTypes: ['customer', 'anonymous'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A service/area search returned nothing serviceable.',
  }),

  // ── matching ─────────────────────────────────────────────────────────────────
  'matching.no_providers': def({
    name: 'matching.no_providers',
    category: 'matching',
    defaultSeverity: 'medium',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'Matching produced no suitable providers for a request.',
  }),
  'matching.provider_accepted_no_response': def({
    name: 'matching.provider_accepted_no_response',
    category: 'matching',
    defaultSeverity: 'medium',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A provider accepted a lead but never followed up with the customer.',
  }),
  'matching.shortlist_ready': def({
    name: 'matching.shortlist_ready',
    category: 'matching',
    defaultSeverity: 'info',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A qualified shortlist became available to the customer.',
  }),

  // ── quote ────────────────────────────────────────────────────────────────────
  'quote.sent': def({
    name: 'quote.sent',
    category: 'quote',
    defaultSeverity: 'info',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A quote was sent to a customer.',
  }),
  'quote.approval_abandoned': def({
    name: 'quote.approval_abandoned',
    category: 'quote',
    defaultSeverity: 'low',
    actorTypes: ['customer'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A customer opened but did not complete a quote approval.',
  }),

  // ── booking ──────────────────────────────────────────────────────────────────
  'booking.created': def({
    name: 'booking.created',
    category: 'booking',
    defaultSeverity: 'info',
    actorTypes: ['customer', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A booking was created.',
  }),
  'booking.failed': def({
    name: 'booking.failed',
    category: 'booking',
    defaultSeverity: 'high',
    actorTypes: ['customer', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'A booking attempt failed.',
  }),

  // ── payment ──────────────────────────────────────────────────────────────────
  'payment.succeeded': def({
    name: 'payment.succeeded',
    category: 'payment',
    defaultSeverity: 'info',
    actorTypes: ['customer', 'provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A payment settled successfully.',
  }),
  'payment.failed': def({
    name: 'payment.failed',
    category: 'payment',
    defaultSeverity: 'high',
    actorTypes: ['customer', 'provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'A payment attempt failed.',
  }),

  // ── voucher ──────────────────────────────────────────────────────────────────
  'voucher.redeemed': def({
    name: 'voucher.redeemed',
    category: 'voucher',
    defaultSeverity: 'info',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A promo voucher/credit was redeemed.',
  }),
  'voucher.redemption_failed': def({
    name: 'voucher.redemption_failed',
    category: 'voucher',
    defaultSeverity: 'medium',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A voucher redemption attempt failed.',
  }),

  // ── provider_onboarding ──────────────────────────────────────────────────────
  'provider_onboarding.completed': def({
    name: 'provider_onboarding.completed',
    category: 'provider_onboarding',
    defaultSeverity: 'info',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A provider finished onboarding.',
  }),
  'provider_onboarding.stalled': def({
    name: 'provider_onboarding.stalled',
    category: 'provider_onboarding',
    defaultSeverity: 'medium',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A provider started but did not complete onboarding.',
  }),

  // ── kyc ──────────────────────────────────────────────────────────────────────
  'kyc.document_upload_failed': def({
    name: 'kyc.document_upload_failed',
    category: 'kyc',
    defaultSeverity: 'high',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    // KYC carries identity documents — never trust free text here.
    redactionProfile: 'strict',
    description: 'A KYC document upload failed (no document contents captured).',
  }),
  'kyc.verification_completed': def({
    name: 'kyc.verification_completed',
    category: 'kyc',
    defaultSeverity: 'info',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'A provider identity verification reached a terminal decision.',
  }),

  // ── whatsapp ─────────────────────────────────────────────────────────────────
  'whatsapp.message_delivery_failed': def({
    name: 'whatsapp.message_delivery_failed',
    category: 'whatsapp',
    defaultSeverity: 'medium',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'An outbound WhatsApp message failed to deliver (no body captured).',
  }),
  'whatsapp.inbound_received': def({
    name: 'whatsapp.inbound_received',
    category: 'whatsapp',
    defaultSeverity: 'info',
    actorTypes: ['customer', 'provider'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'An inbound WhatsApp message was received (metadata only, no body).',
  }),

  // ── notification ─────────────────────────────────────────────────────────────
  'notification.dispatch_failed': def({
    name: 'notification.dispatch_failed',
    category: 'notification',
    defaultSeverity: 'medium',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A push/notification dispatch failed.',
  }),

  // ── job_execution ────────────────────────────────────────────────────────────
  'job_execution.completed': def({
    name: 'job_execution.completed',
    category: 'job_execution',
    defaultSeverity: 'info',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A job was marked complete.',
  }),
  'job_execution.provider_no_show': def({
    name: 'job_execution.provider_no_show',
    category: 'job_execution',
    defaultSeverity: 'high',
    actorTypes: ['provider', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A provider did not show up for a scheduled job.',
  }),

  // ── admin_action ─────────────────────────────────────────────────────────────
  'admin_action.override_applied': def({
    name: 'admin_action.override_applied',
    category: 'admin_action',
    defaultSeverity: 'low',
    actorTypes: ['admin'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'An admin applied a manual override (also recorded in the audit log).',
  }),
  'admin_action.manual_workaround': def({
    name: 'admin_action.manual_workaround',
    category: 'admin_action',
    defaultSeverity: 'medium',
    actorTypes: ['admin'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'An admin performed a repeatable manual workaround for a product gap.',
  }),

  // ── security ─────────────────────────────────────────────────────────────────
  'security.event_raised': def({
    name: 'security.event_raised',
    category: 'security',
    defaultSeverity: 'high',
    actorTypes: ['system', 'admin'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'A SecurityEvent was raised (mirrors the security_events system of record).',
  }),

  // ── system_error ─────────────────────────────────────────────────────────────
  'system_error.frontend_high_severity': def({
    name: 'system_error.frontend_high_severity',
    category: 'system_error',
    defaultSeverity: 'high',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'A high-severity frontend error was reported.',
  }),
  'system_error.legal_link_broken': def({
    name: 'system_error.legal_link_broken',
    category: 'system_error',
    defaultSeverity: 'medium',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A privacy/terms/legal link returned an error or 404.',
  }),
  'system_error.backend_unhandled': def({
    name: 'system_error.backend_unhandled',
    category: 'system_error',
    defaultSeverity: 'high',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'strict',
    description: 'An unhandled backend error surfaced to a user.',
  }),

  // ── campaign ─────────────────────────────────────────────────────────────────
  'campaign.broadcast_requested': def({
    name: 'campaign.broadcast_requested',
    category: 'campaign',
    defaultSeverity: 'low',
    actorTypes: ['admin', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A bulk outbound campaign was requested (subject to human-review gating).',
  }),

  // ── support ──────────────────────────────────────────────────────────────────
  'support.ticket_escalated': def({
    name: 'support.ticket_escalated',
    category: 'support',
    defaultSeverity: 'medium',
    actorTypes: ['admin', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'A support case was escalated.',
  }),
  'support.recurring_issue': def({
    name: 'support.recurring_issue',
    category: 'support',
    defaultSeverity: 'medium',
    actorTypes: ['admin', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    redactionProfile: 'standard',
    description: 'A recurring support theme was detected.',
  }),

  // ── improvement_candidate (meta) ──────────────────────────────────────────────
  'improvement_candidate.created': def({
    name: 'improvement_candidate.created',
    category: 'improvement_candidate',
    defaultSeverity: 'info',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'aggregate',
    description: 'The learning layer produced an improvement candidate.',
  }),

  // ── ops agent workflow team ──────────────────────────────────────────────────
  'ops.agent.run': def({
    name: 'ops.agent.run',
    category: 'admin_action',
    defaultSeverity: 'info',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'An ops agent completed a scheduled, event, or manual run.',
  }),
  'ops.recommendation.evaluated': def({
    name: 'ops.recommendation.evaluated',
    category: 'admin_action',
    defaultSeverity: 'info',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    // strict: defence-in-depth so an over-length unknown string (e.g. a future
    // evaluator summary that interpolates a name) is summarised, not leaked.
    redactionProfile: 'strict',
    description: 'An ops agent produced or refreshed a recommendation for admin review.',
  }),
  'ops.recommendation.reviewed': def({
    name: 'ops.recommendation.reviewed',
    category: 'admin_action',
    defaultSeverity: 'info',
    actorTypes: ['admin'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'standard',
    description: 'An admin acknowledged, actioned, or dismissed an ops recommendation.',
  }),
  'ops.draft.sent': def({
    name: 'ops.draft.sent',
    category: 'whatsapp',
    defaultSeverity: 'info',
    actorTypes: ['admin', 'system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'An ops agent draft message was approved and sent.',
  }),
  'ops.draft.blocked': def({
    name: 'ops.draft.blocked',
    category: 'whatsapp',
    defaultSeverity: 'low',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'An ops agent draft was blocked by messaging policy (opt-out / no session).',
  }),
  'ops.escalation': def({
    name: 'ops.escalation',
    category: 'admin_action',
    defaultSeverity: 'high',
    actorTypes: ['system'],
    openBrainEligible: true,
    improvementCandidateEligible: true,
    // strict: the escalation carries the evaluator summary as `reason`; summarise
    // any over-length unknown string rather than forwarding it verbatim.
    redactionProfile: 'strict',
    description: 'An ops agent escalated an entity needing urgent ops attention.',
  }),

  // ── workflow funnel event log ────────────────────────────────────────────────
  // One umbrella event for the durable WorkflowEvent stream (recordWorkflowEvent).
  // The concrete funnel type travels in metadata.workflowEventType. Strict
  // redaction because callers across the funnel may pass through free text.
  'workflow.event': def({
    name: 'workflow.event',
    category: 'workflow',
    defaultSeverity: 'info',
    actorTypes: ['customer', 'provider', 'admin', 'system', 'anonymous'],
    openBrainEligible: true,
    improvementCandidateEligible: false,
    redactionProfile: 'strict',
    description: 'A key operational funnel event was recorded (provider/request/match/job/payment lifecycle).',
  }),
}

export function isKnownEvent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENT_DEFINITIONS, name)
}

export function getEventDefinition(name: string): EventDefinition | undefined {
  return EVENT_DEFINITIONS[name]
}

export function eventsByCategory(category: EventCategory): EventDefinition[] {
  return Object.values(EVENT_DEFINITIONS).filter((d) => d.category === category)
}

export function isValidCategory(value: string): value is EventCategory {
  return (EVENT_CATEGORIES as readonly string[]).includes(value)
}

export function isValidSeverity(value: string): value is EventSeverity {
  return (EVENT_SEVERITIES as readonly string[]).includes(value)
}

export function isValidActorType(value: string): value is ActorType {
  return (ACTOR_TYPES as readonly string[]).includes(value)
}
