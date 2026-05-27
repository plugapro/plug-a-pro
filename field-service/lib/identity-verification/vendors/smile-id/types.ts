// Smile ID API request/response types.
// Sourced from: docs.usesmileid.com/integration-options/no-code/smile-links/rest-api
// Items confirmed only in sandbox are noted in
// docs/superpowers/notes/2026-05-27-smile-id-sandbox-probe.md.

// ─── Smile Links create request ──────────────────────────────────────────

export type SmileLinkIdType = {
  country: string                  // ISO 3166-1 alpha-2 (e.g. 'ZA')
  id_type: string                  // 'IDENTITY_CARD' for SA EVD
  verification_method: string      // resolved by sandbox probe (Task 2) — likely 'doc_verification'
}

export type SmileLinkPartnerParams = {
  user_id: string                  // Smile requires user_id nested HERE, not top-level
  job_id: string                   // partner-supplied, globally unique forever
  job_type: number                 // 11 for Enhanced Document Verification
  verification_id: string          // Plug A Pro internal id — travels back on every callback
  [key: string]: string | number   // partner_params accepts arbitrary string-coerced extras
}

export type SmileLinksCreateRequest = {
  partner_id: string
  timestamp: string                // ISO-8601 with ms
  signature: string                // base64 HMAC; see signing.ts
  source_sdk: 'rest_api'
  source_sdk_version: string

  name: string                     // shown in Smile portal for this link
  company_name: string
  id_types: SmileLinkIdType[]
  callback_url: string             // REQUIRED — Smile Links rejects requests without this
  is_single_use: boolean
  partner_params: SmileLinkPartnerParams
  expires_at: string               // ISO-8601 with ms

  // Optional fields, not used in v1:
  data_privacy_policy_url?: string
  logo_url?: string
  redirect_url?: string
}

// ─── Smile Links create response ─────────────────────────────────────────

export type SmileLinksCreateResponse = {
  link_url: string                 // user-facing URL we 302 to from /provider/verify/[token]/liveness
  ref_id: string                   // Smile Link id; stored as livenessSessionReference
  disabled_at: string | null
  id_types: SmileLinkIdType[]
  expires_at?: string
  is_single_use?: boolean
  partner_id?: string
}

// ─── Smile Links disable request (PUT) ───────────────────────────────────

export type SmileLinksDisableRequest = {
  partner_id: string
  timestamp: string
  signature: string
  is_disabled: true
}

// ─── EVD webhook payload ─────────────────────────────────────────────────

export type SmileEvdActions = {
  Liveness_Check?: string
  Selfie_To_ID_Card_Compare?: string
  Document_Check?: string
  Verify_Document?: string
  Register_Selfie?: string
  Return_Personal_Info?: string
  Human_Review_Compare?: string
  Human_Review_Document_Check?: string
  Human_Review_Liveness_Check?: string
  [key: string]: string | undefined
}

export type SmileEvdImageLinks = {
  id_card_back?: string
  id_card_image?: string
  selfie_image?: string
  [key: string]: string | undefined
}

export type SmileEvdWebhookPayload = {
  SmileJobID: string
  PartnerParams: SmileLinkPartnerParams
  ResultCode: string
  ResultText?: string
  ResultType?: string
  Actions?: SmileEvdActions
  Source?: string
  signature: string
  timestamp: string

  // IsFinalResult comes back as a STRING "true"/"false" (per smile-identity-core SDK);
  // do NOT compare with `=== true` boolean. Adapter normalises in parse.ts.
  IsFinalResult?: string | boolean

  // PII fields — keys present depend on EVD product variant. Treat ALL of these
  // as PII for redaction; do not log raw values.
  ImageLinks?: SmileEvdImageLinks
  KYCReceipt?: string
  FullName?: string
  IDNumber?: string
  SecondaryIDNumber?: string
  DOB?: string
  Gender?: string
  Address?: string
  IssuanceDate?: string
  ExpirationDate?: string
  Photo?: string
  Personal_Info?: Record<string, unknown>

  [key: string]: unknown
}
