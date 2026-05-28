// Didit identity verification adapter.
//
// Didit is a hosted all-in-one KYC service (ID + selfie + liveness + AML
// + optional SA DHA validation, all collected in Didit's hosted UI).
// Maps onto the existing VerificationVendorAdapter contract by following
// the Smile Links pattern: submitDocumentCheck mints a synthetic
// correlation reference (no vendor call yet) and createLivenessSession
// performs the actual POST /v3/session/.
//
// vendor_data sent to Didit is the internal verification cuid (not PII);
// it travels back on every webhook so we can join records.

import type {
  CancelVerificationJobInput,
  CancelVerificationJobResult,
  CreateLivenessSessionInput,
  CreateLivenessSessionResult,
  ParseWebhookInput,
  ParseWebhookResult,
  SubmitDocumentCheckInput,
  SubmitDocumentCheckResult,
  VerificationVendorAdapter,
} from '../types'
import { parseDiditWebhook } from './parse'
import { createDiditSession, diditPlaceholderReference } from './session'

async function submitDocumentCheck(
  _input: SubmitDocumentCheckInput,
): Promise<SubmitDocumentCheckResult> {
  // Didit collects documents + selfie + liveness inside the hosted page;
  // there's no document submission API to call here. Return a synthetic
  // correlation reference so the orchestrator's two-phase flow continues
  // to createLivenessSession, where the real Didit session is created.
  return {
    vendorReference: diditPlaceholderReference(),
    expectsWebhook: true,
  }
}

async function createLivenessSession(
  input: CreateLivenessSessionInput,
): Promise<CreateLivenessSessionResult> {
  // Default to KYC_AUTHORITATIVE for provider onboarding. Other callers
  // (e.g. internal admin smoke tests against KYC_BASIC) should invoke
  // session.createDiditSession directly with the desired profile.
  return createDiditSession(input)
}

async function parseWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult> {
  return parseDiditWebhook(input)
}

async function cancelVerificationJob(
  _input: CancelVerificationJobInput,
): Promise<CancelVerificationJobResult> {
  // Didit does not currently expose a session-cancel endpoint. Orphans
  // (e.g. ORCHESTRATOR_CONTENTION_ORPHAN) are left to expire via Didit's
  // own session TTL; our row is marked dead via the orchestrator's
  // contention path. Returning supported:false signals the orchestrator
  // to skip remote cancellation cleanly.
  return { supported: false, vendorAcknowledged: false }
}

export const diditVerificationAdapter: VerificationVendorAdapter = {
  vendorKey: 'didit',
  submitDocumentCheck,
  createLivenessSession,
  parseWebhook,
  cancelVerificationJob,
}
