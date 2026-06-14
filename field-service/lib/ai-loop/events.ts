/**
 * Plug-A-Pro AI operating loop — the operational event contract + validation.
 *
 * An OperationalEvent is the typed envelope a sensor hands to the writer. It is
 * deliberately small: a stable name (looked up in the taxonomy), who/what it
 * concerns by *reference only*, when, and safe metadata. Raw PII does not belong
 * here — validateEvent rejects it before anything is persisted.
 */

import {
  getEventDefinition,
  isKnownEvent,
  isValidActorType,
  isValidCategory,
  isValidSeverity,
  type ActorType,
  type EventCategory,
  type EventSeverity,
} from './taxonomy'
import { findRawSensitiveFields } from './redaction'

export interface OperationalEvent {
  /** Must exist in the taxonomy. */
  name: string
  /** Optional override; if set must equal the taxonomy category. */
  category?: EventCategory
  /** Optional override; defaults to the taxonomy defaultSeverity. */
  severity?: EventSeverity
  actorType: ActorType
  /** Internal id of the actor. Phone-like values are hashed by the writer. */
  actorRef?: string | null
  /** Internal entity references only, e.g. { jobRequestId, bookingId }. */
  entityRefs?: Record<string, string>
  /** The business flow this event belongs to (e.g. "payment", "kyc"). */
  affectedFlow?: string
  /** ISO-8601 timestamp of when the event occurred. */
  occurredAt: string
  /** Safe, structured metadata. Must not contain raw DENY-tier fields. */
  metadata?: Record<string, unknown>
  /** Marks synthetic/test-cohort events so they can be filtered downstream. */
  isTestEvent?: boolean
}

export type ValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] }

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

/**
 * Validate shape, taxonomy membership, and — critically — that no raw DENY-tier
 * sensitive field is present anywhere in metadata, entityRefs, or actorRef.
 * Pure and synchronous so it can run anywhere, including hot paths.
 */
export function validateEvent(event: OperationalEvent): ValidationResult {
  const errors: string[] = []

  if (!event || typeof event !== 'object') {
    return { ok: false, errors: ['event must be an object'] }
  }

  if (!event.name || typeof event.name !== 'string') {
    errors.push('name is required')
  } else if (!isKnownEvent(event.name)) {
    errors.push(`unknown event name: ${event.name}`)
  }

  const def = event.name ? getEventDefinition(event.name) : undefined

  if (!event.actorType || !isValidActorType(event.actorType)) {
    errors.push(`invalid actorType: ${String(event.actorType)}`)
  } else if (def && !def.actorTypes.includes(event.actorType)) {
    errors.push(`actorType ${event.actorType} not allowed for ${event.name}`)
  }

  if (event.category && !isValidCategory(event.category)) {
    errors.push(`invalid category: ${event.category}`)
  } else if (event.category && def && event.category !== def.category) {
    errors.push(`category ${event.category} does not match taxonomy (${def.category})`)
  }

  if (event.severity && !isValidSeverity(event.severity)) {
    errors.push(`invalid severity: ${event.severity}`)
  }

  if (!event.occurredAt || typeof event.occurredAt !== 'string' || !ISO_RE.test(event.occurredAt)) {
    errors.push('occurredAt must be an ISO-8601 timestamp')
  }

  if (event.entityRefs) {
    for (const [key, value] of Object.entries(event.entityRefs)) {
      if (typeof value !== 'string') {
        errors.push(`entityRefs.${key} must be a string id`)
      }
    }
  }

  // The non-negotiable gate: nothing carrying a raw secret/token/government-id/
  // biometric/card/otp/password may proceed.
  const sensitiveTargets: Array<[string, unknown]> = [
    ['metadata', event.metadata],
    ['entityRefs', event.entityRefs],
  ]
  if (event.actorRef) sensitiveTargets.push(['actorRef', { actorRef: event.actorRef }])

  for (const [label, target] of sensitiveTargets) {
    const findings = findRawSensitiveFields(target)
    for (const f of findings) {
      errors.push(`raw sensitive field rejected: ${label}.${f.path} (matched "${f.matched}")`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, errors: [] }
}
