import type { IdentityBasis, IdentityDocumentKind } from '@prisma/client'

export type VendorKey = 'smile_id' | 'didit' | 'thisisme' | 'datanamix' | 'omnicheck' | 'manual' | 'mock'

export type NormalizedVerificationDecision =
  | 'PASS'
  | 'FAIL'
  | 'INCONCLUSIVE'
  | 'MANUAL_REVIEW'
  | 'PROVIDER_UNAVAILABLE'

export type NormalizedVerificationResult = {
  decision: NormalizedVerificationDecision
  confidence: number | null
  documentConfidence: number | null
  livenessScore: number | null
  selfieMatchScore: number | null
  livenessVerified: boolean | null
  riskFlags: string[]
  reasonCode: string | null
  vendorReference: string | null
  expiresAt: Date | null
  // Optional adapter hint for the assurance level to record on a PASSED
  // verdict. When unset, the orchestrator falls back to its default ('HIGH')
  // so existing adapters (Smile ID, mock) remain unaffected. Hosted-flow
  // vendors with multiple workflow tiers (e.g. Didit basic vs authoritative)
  // use this to differentiate without altering shared orchestrator logic.
  assuranceLevelHint?: 'HIGH' | 'MEDIUM' | null
}

export type SubmitDocumentCheckInput = {
  verificationId: string
  providerId: string | null
  identityBasis: IdentityBasis
  issuingCountry: string | null
  identifierHash: string | null
  identifierLast4: string | null
  identifierPlaintext: string | null
  documents: Array<{
    id: string
    kind: IdentityDocumentKind
    blobKey: string
    mimeType: string
    sha256: string
  }>
  webhookCallbackUrl: string
  livenessReturnUrl: string
}

export type SubmitDocumentCheckResult = {
  vendorReference: string
  immediateResult?: NormalizedVerificationResult
  expectsWebhook: boolean
}

export type CreateLivenessSessionInput = {
  verificationId: string
  providerId: string | null
  returnUrl: string
  // The partner-side reference returned by the immediately-preceding
  // submitDocumentCheck() call. Adapters that mint a vendor session in
  // createLivenessSession need this value at call time because the
  // orchestrator has not yet stamped vendorReference onto the DB row
  // (Phase 3 commit happens after both vendor calls).
  submittedVendorReference: string | null
  // Per-request webhook callback URL. Adapters whose link/job creation
  // API requires callback_url as a body field (e.g., Smile Links) must
  // send this value; portal-level fallback is fallback only.
  webhookCallbackUrl: string
}

export type CreateLivenessSessionResult = {
  vendorReference: string
  sessionUrl: string
  expiresAt: Date
}

export type ParseWebhookInput = {
  headers: Record<string, string>
  rawBody: string
}

export type ParseWebhookResult = {
  signatureValid: boolean
  vendorEventId: string | null
  vendorReference: string | null
  livenessSessionReference: string | null
  eventType: string | null
  payloadHash: string
  redactedPayload: Record<string, unknown> | null
  result: NormalizedVerificationResult | null
}

export type CancelVerificationJobInput = {
  verificationId: string
  vendorReference: string | null
  livenessSessionReference: string | null
  reason: 'PROVIDER_WITHDREW_CONSENT' | 'ADMIN_CANCELLED' | 'INTERNAL_TIMEOUT' | 'ORCHESTRATOR_CONTENTION_ORPHAN'
}

export type CancelVerificationJobResult = {
  supported: boolean
  vendorAcknowledged: boolean
}

export type VerificationVendorAdapter = {
  vendorKey: VendorKey
  submitDocumentCheck(input: SubmitDocumentCheckInput): Promise<SubmitDocumentCheckResult>
  createLivenessSession?(input: CreateLivenessSessionInput): Promise<CreateLivenessSessionResult>
  parseWebhook(input: ParseWebhookInput): Promise<ParseWebhookResult>
  cancelVerificationJob(input: CancelVerificationJobInput): Promise<CancelVerificationJobResult>
}

export function providerUnavailableResult(reasonCode = 'PROVIDER_UNAVAILABLE'): NormalizedVerificationResult {
  return {
    decision: 'PROVIDER_UNAVAILABLE',
    confidence: null,
    documentConfidence: null,
    livenessScore: null,
    selfieMatchScore: null,
    livenessVerified: null,
    riskFlags: [],
    reasonCode,
    vendorReference: null,
    expiresAt: null,
  }
}
