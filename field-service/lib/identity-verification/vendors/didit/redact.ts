// Didit webhook payload redaction for audit storage.
//
// Strategy mirrors smile-id/redact.ts: default-REDACT with an explicit
// allowlist of fields safe to preserve. If Didit adds a new identity-adjacent
// field (Address, IDNumber, FaceImage, etc.), it is auto-redacted by default
// rather than landing in audit logs.

const REDACTED = '[REDACTED]'

const PRESERVED_KEYS: ReadonlySet<string> = new Set([
  // Envelope
  'event_id',
  'webhook_type',
  'timestamp',
  'created_at',
  'application_id',
  'session_id',
  'session_kind',
  'session_number',
  'workflow_id',
  'vendor_data',
  'callback',
  'status',
  'expires_at',
  // Decision / feature-array verdict labels — not PII
  'decision',
  'id_verifications',
  'liveness_checks',
  'face_matches',
  'aml_screenings',
  'database_validations',
  'phone_verifications',
  'email_verifications',
  // Feature-check sub-keys
  'feature',
  'node_id',
  'warnings',
  'risk_code',
  'log_type',
  'short_description',
  'long_description',
  'score',
  'confidence',
  // Metadata — we control what goes here; preserve so debug stays useful
  'metadata',
])

const MAX_DEPTH = 32

export function redactDiditPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return redactValue(value, 0) as Record<string, unknown>
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (!PRESERVED_KEYS.has(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = redactValue(nested, depth + 1)
  }
  return out
}
