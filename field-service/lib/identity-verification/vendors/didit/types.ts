// Didit API + webhook payload types.
// Source: https://docs.didit.me/sessions-api/create-session
//         https://docs.didit.me/sessions-api/retrieve-session
//         https://docs.didit.me/integration/webhooks

// ─── Session create ─────────────────────────────────────────────────────

export type DiditSessionCreateRequest = {
  workflow_id: string
  vendor_data: string          // we set this to our internal verificationId
  callback?: string            // browser return URL after user finishes on Didit
  metadata?: Record<string, unknown>
  contact_details?: {
    email?: string | null
    phone?: string | null
  }
  expected_details?: {
    first_name?: string | null
    last_name?: string | null
  }
}

export type DiditSessionCreateResponse = {
  session_id: string
  session_number?: number
  session_token?: string
  url: string                  // hosted verification URL to redirect provider to
  status: string               // initial 'Not Started'
  vendor_data?: string
  workflow_id?: string
  callback?: string
  metadata?: Record<string, unknown>
  created_at?: string
  expires_at?: string | null   // not always present; we derive internally when missing
}

// ─── Session decision (GET /v3/session/{id}/decision/) ──────────────────

export type DiditFeatureCheck = {
  status?: string              // 'Passed' | 'Failed' | 'Under Review' | ...
  score?: number | null
  confidence?: number | null
  warnings?: Array<{
    feature?: string
    risk_code?: string
    log_type?: string
    short_description?: string
    long_description?: string
  }>
  // arbitrary additional fields are allowed
  [key: string]: unknown
}

export type DiditDecisionResponse = {
  session_id: string
  session_kind?: 'user' | 'business'
  status: string                                    // top-level Didit status string
  vendor_data?: string | null
  workflow_id?: string | null
  callback?: string | null
  created_at?: string
  expires_at?: string | null
  decision?: Record<string, unknown> | null
  id_verifications?: DiditFeatureCheck[]
  liveness_checks?: DiditFeatureCheck[]
  face_matches?: DiditFeatureCheck[]
  aml_screenings?: DiditFeatureCheck[]
  database_validations?: DiditFeatureCheck[]
  // additional feature arrays may appear over time
  [key: string]: unknown
}

// ─── Webhook envelope ───────────────────────────────────────────────────

export type DiditWebhookEnvelope = {
  event_id?: string
  webhook_type?: string                              // 'status.updated' | 'data.updated' | …
  timestamp?: number | string
  created_at?: string
  application_id?: string
  session_id?: string
  workflow_id?: string
  vendor_data?: string
  status?: string
  decision?: DiditDecisionResponse | null
  // forward-compatibility: ignore everything else
  [key: string]: unknown
}

// Type guards — minimal narrowing without zod runtime cost; keep tight to
// what the adapter actually reads. Anything else is treated as opaque JSON
// to be redacted before audit storage.

export function isDiditSessionCreateResponse(value: unknown): value is DiditSessionCreateResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.session_id === 'string' && typeof v.url === 'string' && typeof v.status === 'string'
}

export function isDiditDecisionResponse(value: unknown): value is DiditDecisionResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.session_id === 'string' && typeof v.status === 'string'
}

export function isDiditWebhookEnvelope(value: unknown): value is DiditWebhookEnvelope {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.session_id === 'string' || typeof v.event_id === 'string'
}
