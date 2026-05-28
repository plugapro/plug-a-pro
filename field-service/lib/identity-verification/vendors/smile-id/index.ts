import { randomUUID } from 'crypto'
import type {
  VerificationVendorAdapter,
  SubmitDocumentCheckInput,
  SubmitDocumentCheckResult,
  CreateLivenessSessionInput,
  CreateLivenessSessionResult,
  ParseWebhookInput,
  ParseWebhookResult,
  CancelVerificationJobInput,
  CancelVerificationJobResult,
} from '../types'
import { createSmileLink, disableSmileLink } from './smile-links-client'
import { parseSmileWebhook } from './parse'

const DEFAULT_SMILE_LINK_TTL_MINUTES = 60

function partnerJobId(): string {
  return `pap-${randomUUID()}`
}

function computeExpiresAt(): Date {
  const minutes = Number(process.env.SMILE_ID_LINK_TTL_MINUTES) || DEFAULT_SMILE_LINK_TTL_MINUTES
  return new Date(Date.now() + minutes * 60 * 1000)
}

async function submitDocumentCheck(
  _input: SubmitDocumentCheckInput,
): Promise<SubmitDocumentCheckResult> {
  // Smile Links combines doc + selfie + liveness into one user flow.
  // submitDocumentCheck merely mints the partner-side correlation id;
  // the actual Smile API call happens in createLivenessSession.
  return {
    vendorReference: partnerJobId(),
    expectsWebhook: true,
  }
}

async function createLivenessSession(
  input: CreateLivenessSessionInput,
): Promise<CreateLivenessSessionResult> {
  if (!input.submittedVendorReference) {
    throw new Error(
      'Smile ID createLivenessSession requires submittedVendorReference ' +
      '(the partner_job_id from submitDocumentCheck)',
    )
  }

  const created = await createSmileLink({
    verificationId: input.verificationId,
    providerId: input.providerId,
    partnerJobId: input.submittedVendorReference,
    callbackUrl: input.webhookCallbackUrl,
    expiresAt: computeExpiresAt(),
  })

  return {
    vendorReference: created.refId,
    sessionUrl: created.linkUrl,
    expiresAt: created.expiresAt ? new Date(created.expiresAt) : computeExpiresAt(),
  }
}

async function parseWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult> {
  return parseSmileWebhook(input)
}

async function cancelVerificationJob(
  input: CancelVerificationJobInput,
): Promise<CancelVerificationJobResult> {
  if (!input.livenessSessionReference) {
    return { supported: false, vendorAcknowledged: false }
  }
  const r = await disableSmileLink(input.livenessSessionReference)
  return { supported: true, vendorAcknowledged: r.acknowledged }
}

export const smileIdVerificationAdapter: VerificationVendorAdapter = {
  vendorKey: 'smile_id',
  submitDocumentCheck,
  createLivenessSession,
  parseWebhook,
  cancelVerificationJob,
}
