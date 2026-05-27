export const IDENTITY_BASES = [
  'SA_ID',
  'PASSPORT',
  'REFUGEE_ID',
  'ASYLUM_PERMIT',
  'REFUGEE_PERMIT',
  'WORK_PERMIT',
  'PERMANENT_RESIDENCE_PERMIT',
] as const

export const VERIFICATION_CHANNELS = ['PWA', 'WHATSAPP', 'ADMIN', 'VENDOR'] as const

export const VERIFICATION_STATUSES = [
  'NOT_STARTED',
  'STARTED',
  'CONSENTED',
  'AWAITING_IDENTIFIER',
  'AWAITING_DOCUMENT',
  'AWAITING_SELFIE',
  'SUBMITTED',
  'PROCESSING',
  'AWAITING_LIVENESS',
  'NEEDS_MANUAL_REVIEW',
  'RETRY_REQUIRED',
  'PASSED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const

export const VERIFICATION_DECISIONS = [
  'PASS',
  'FAIL',
  'MANUAL_REVIEW',
  'RETRY_REQUIRED',
  'PROVIDER_UNAVAILABLE',
] as const

export const VERIFICATION_ASSURANCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const

export type IdentityBasis = (typeof IDENTITY_BASES)[number]

export function isIdentityBasis(value: unknown): value is IdentityBasis {
  return typeof value === 'string' && (IDENTITY_BASES as readonly string[]).includes(value)
}

export type VerificationChannel = (typeof VERIFICATION_CHANNELS)[number]
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number]
export type VerificationAssuranceLevel = (typeof VERIFICATION_ASSURANCE_LEVELS)[number]

export const NON_TERMINAL_VERIFICATION_STATUSES = [
  'NOT_STARTED',
  'STARTED',
  'CONSENTED',
  'AWAITING_IDENTIFIER',
  'AWAITING_DOCUMENT',
  'AWAITING_SELFIE',
  'SUBMITTED',
  'PROCESSING',
  'AWAITING_LIVENESS',
  'NEEDS_MANUAL_REVIEW',
  'RETRY_REQUIRED',
] as const satisfies readonly VerificationStatus[]

export type IdentityDocumentKind =
  | 'ID_FRONT'
  | 'ID_BACK'
  | 'GREEN_ID_BOOK'
  | 'PASSPORT_PHOTO_PAGE'
  | 'VISA'
  | 'WORK_PERMIT'
  | 'ASYLUM_SEEKER_PERMIT_SECTION_22'
  | 'REFUGEE_PERMIT_SECTION_24'
  | 'REFUGEE_ID'
  | 'SELFIE'
  | 'LIVENESS_FRAME'

export interface StartVerificationInput {
  verificationId: string
  identityBasis: IdentityBasis
  channel: VerificationChannel
}

export interface SubmitVerificationInput extends StartVerificationInput {
  documentKinds: IdentityDocumentKind[]
}

export interface WebhookVerificationInput {
  providerName: string
  providerReference: string
  payload: unknown
}

export interface ProviderVerificationResult {
  status: VerificationStatus
  decision?: VerificationDecision
  assuranceLevel?: VerificationAssuranceLevel
  failureReasonCode?: string
  rawPayloadRedacted?: unknown
}

export type ProviderStartResult = ProviderVerificationResult
export type ProviderSubmitResult = ProviderVerificationResult
export type ProviderWebhookResult = ProviderVerificationResult

export interface IdentityVerificationProvider {
  name: string
  supports(input: { identityBasis: IdentityBasis; channel: VerificationChannel }): boolean
  start(input: StartVerificationInput): Promise<ProviderStartResult>
  submit(input: SubmitVerificationInput): Promise<ProviderSubmitResult>
  handleWebhook?(input: WebhookVerificationInput): Promise<ProviderWebhookResult>
}

export function getRequiredDocumentKinds(identityBasis: IdentityBasis): IdentityDocumentKind[] {
  switch (identityBasis) {
    case 'SA_ID':
      return ['ID_FRONT', 'SELFIE']
    case 'PASSPORT':
      return ['PASSPORT_PHOTO_PAGE', 'SELFIE']
    case 'REFUGEE_ID':
      return ['REFUGEE_ID', 'SELFIE']
    case 'ASYLUM_PERMIT':
      return ['ASYLUM_SEEKER_PERMIT_SECTION_22', 'SELFIE']
    case 'REFUGEE_PERMIT':
      return ['REFUGEE_PERMIT_SECTION_24', 'SELFIE']
    case 'WORK_PERMIT':
      return ['PASSPORT_PHOTO_PAGE', 'WORK_PERMIT', 'SELFIE']
    case 'PERMANENT_RESIDENCE_PERMIT':
      return ['PASSPORT_PHOTO_PAGE', 'VISA', 'SELFIE']
  }
}
