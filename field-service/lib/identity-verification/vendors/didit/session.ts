// Didit createLivenessSession implementation.
//
// Following the Smile Links pattern (submitDocumentCheck returns just a
// synthetic correlation reference, createLivenessSession does the real
// vendor call), we mint the Didit session here and return the hosted URL
// plus the Didit session_id (used as both vendorReference and
// livenessSessionReference for joining webhook events).
//
// vendor_data is set to our internal verificationId (cuid, not PII) so
// Didit can join sessions to our records in their dashboard and so future
// webhooks carry the correlation.

import { randomUUID } from 'crypto'
import type { CreateLivenessSessionInput, CreateLivenessSessionResult } from '../types'
import { postSession } from './client'
import { deriveSessionExpiresAt, getDiditWorkflowId, type DiditWorkflowProfile } from './config'

export function diditPlaceholderReference(): string {
  // Synthetic value returned by submitDocumentCheck before the real Didit
  // session_id is known. Mirrors the smile-id `pap-…` convention.
  return `didit-pre:${randomUUID()}`
}

export type CreateDiditSessionOptions = {
  workflowProfile?: DiditWorkflowProfile
}

export async function createDiditSession(
  input: CreateLivenessSessionInput,
  options: CreateDiditSessionOptions = {},
): Promise<CreateLivenessSessionResult> {
  const profile: DiditWorkflowProfile = options.workflowProfile ?? 'KYC_AUTHORITATIVE'
  const workflowId = getDiditWorkflowId(profile)

  const response = await postSession({
    workflow_id: workflowId,
    vendor_data: input.verificationId,
    callback: input.returnUrl,
    callback_method: 'both',
    metadata: {
      verification_id: input.verificationId,
      provider_id: input.providerId,
      workflow_profile: profile,
    },
  })

  return {
    vendorReference: response.session_id,
    sessionUrl: response.url,
    // Didit's response does not always include expires_at; derive an
    // internal expiry so the existing /provider/verify/[token]/liveness
    // route's expiry validation has something to compare against.
    expiresAt: response.expires_at ? new Date(response.expires_at) : deriveSessionExpiresAt(),
    vendorWorkflowId: workflowId,
  }
}
