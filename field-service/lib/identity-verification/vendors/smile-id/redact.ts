// Smile ID webhook payload redaction for audit storage.
// Strategy: default-REDACT with an explicit allowlist of fields safe to preserve.
// This fails-safe — if Smile adds a new identity-adjacent field (PlaceOfBirth,
// TaxID, Passport, BiometricHash, etc.), it is automatically redacted instead
// of accidentally landing in audit logs. The allowlist is small and stable.
// Raw `signature` is DROPPED entirely (signatureValid has its own column).

const REDACTED = '[REDACTED]'

// Fields known to be safe to preserve in audit storage.
// Anything NOT in this set is redacted by default.
//
// PartnerParams sub-keys (user_id, job_id, job_type, verification_id) are our
// OWN identifiers that we send TO Smile and Smile round-trips back; they are
// not Smile-issued PII. Actions sub-keys (Liveness_Check, etc.) carry verdict
// labels like "Passed"/"Completed", also not PII.
const PRESERVED_KEYS: ReadonlySet<string> = new Set([
  // Top-level webhook envelope
  'SmileJobID',
  'PartnerParams',
  'ResultCode',
  'ResultText',
  'ResultType',
  'Actions',
  'IsFinalResult',
  'IsMachineResult',
  'Source',
  'timestamp',
  'source_sdk',
  'source_sdk_version',
  'ref_id',
  // PartnerParams sub-keys — our own correlation IDs, not Smile PII
  'user_id',
  'job_id',
  'job_type',
  'verification_id',
  // Actions sub-keys — verdict labels (Passed/Failed/Completed/etc.), not PII
  'Liveness_Check',
  'Selfie_To_ID_Card_Compare',
  'Document_Check',
  'Verify_Document',
  'Human_Review_Compare',
  'Human_Review_Liveness_Check',
  'Human_Review_Document_Check',
  'Register_Selfie',
  'Return_Personal_Info',
  'Selfie_Provided',
  'Selfie_Check',
])

const DROPPED_KEYS: ReadonlySet<string> = new Set([
  'signature',  // raw HMAC; signatureValid is its own column
  'Signature',  // defensive against case variants
])

const MAX_DEPTH = 32

export function redactSmilePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return redactValue(value, 0) as Record<string, unknown>
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1))
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    if (!PRESERVED_KEYS.has(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = redactValue(nested, depth + 1)
  }
  return out
}
