// Didit webhook parser. Produces a ParseWebhookResult that the generic
// /api/webhooks/verification/[vendor] route hands off to the orchestrator.
//
// Contract notes (per vendors/types.ts):
//   - signatureValid drives the 401 short-circuit at the route layer; this
//     parser MUST return false rather than throw when the signature fails.
//   - vendorReference is the Didit session_id (what we stamped on the
//     verification row at session-create time) - joins the webhook event
//     back to the verification record.
//   - result is non-null only for terminal Didit states (Approved /
//     Declined / In Review). Non-decision states (Expired, Abandoned,
//     In Progress, Resubmitted, Awaiting User, Not Started) yield
//     result:null - the webhook event is still stored for audit; no
//     state transition fires (existing TTL handles cleanup).
//   - vendorEventId is Didit's event_id, used for idempotency at the route.

import { createHash } from 'crypto'
import { db } from '../../../db'
import type { ParseWebhookInput, ParseWebhookResult } from '../types'
import { getDiditConfig } from './config'
import { normalizeDiditDecision } from './normalize'
import { redactDiditPayload } from './redact'
import { verifyDiditWebhookSignature } from './signing'
import { isDiditWebhookEnvelope, type DiditWebhookEnvelope } from './types'

export async function parseDiditWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult> {
  const payloadHash = sha256(input.rawBody ?? '')

  let envelope: DiditWebhookEnvelope
  try {
    const parsed: unknown = JSON.parse(input.rawBody)
    if (!isDiditWebhookEnvelope(parsed)) {
      return emptyResult(payloadHash)
    }
    envelope = parsed
  } catch {
    return emptyResult(payloadHash)
  }

  const signature = verifyDiditWebhookSignature(input.rawBody, input.headers)
  const signatureValid = signature.valid

  const sessionId = typeof envelope.session_id === 'string' ? envelope.session_id : null
  const verificationId = typeof envelope.vendor_data === 'string' && envelope.vendor_data.trim()
    ? envelope.vendor_data.trim()
    : null
  const eventId = typeof envelope.event_id === 'string' ? envelope.event_id : null
  const eventType = typeof envelope.webhook_type === 'string' ? envelope.webhook_type : null
  const redactedPayload = redactDiditPayload(envelope)

  // Look up the workflow id we stamped on the verification row at session
  // creation; needed for the basic-vs-authoritative assurance-level decision.
  // Best-effort - when the verification record isn't found we proceed without
  // a hint (orchestrator falls back to its existing default).
  const storedWorkflowId = sessionId ? await lookupStoredWorkflowId(sessionId) : null
  const config = getDiditConfig()
  const authoritativeWorkflowId = config.enabled ? config.workflowIds.authoritative : null

  const normalized = normalizeDiditDecision(envelope, {
    storedVendorWorkflowId: storedWorkflowId,
    authoritativeWorkflowId,
  })

  return {
    signatureValid,
    vendorEventId: eventId,
    vendorReference: sessionId,
    livenessSessionReference: sessionId,
    verificationId,
    eventType,
    payloadHash,
    redactedPayload,
    result: normalized.result,
  }
}

async function lookupStoredWorkflowId(sessionId: string): Promise<string | null> {
  try {
    const row = await db.providerIdentityVerification.findFirst({
      where: {
        OR: [{ vendorReference: sessionId }, { livenessSessionReference: sessionId }],
        sourceCheckProvider: 'didit',
      },
      select: { vendorWorkflowId: true },
    })
    return row?.vendorWorkflowId ?? null
  } catch {
    return null
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function emptyResult(payloadHash: string): ParseWebhookResult {
  return {
    signatureValid: false,
    vendorEventId: null,
    vendorReference: null,
    livenessSessionReference: null,
    verificationId: null,
    eventType: null,
    payloadHash,
    redactedPayload: null,
    result: null,
  }
}
