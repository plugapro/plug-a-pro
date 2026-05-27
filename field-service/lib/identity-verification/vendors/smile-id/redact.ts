// Smile ID webhook payload redaction for audit storage.
// Strategy: explicit denylist of known PII keys, PLUS a regex catch-all for variants.
// Raw `signature` is DROPPED (not preserved as [REDACTED]) because signatureValid
// is recorded on the event row's own column and the raw signature has no audit value.

const REDACTED = '[REDACTED]'

const EXPLICIT_PII_KEYS: ReadonlySet<string> = new Set([
  'Photo', 'ImageLinks', 'KYCReceipt',
  'FullName', 'FirstName', 'LastName', 'MiddleName',
  'IDNumber', 'SecondaryIDNumber',
  'DOB', 'Gender', 'Nationality', 'Country',
  'IssuanceDate', 'ExpirationDate',
  'Address', 'PhoneNumber', 'Email',
  'Personal_Info',
])

const GENERIC_PII_KEY_REGEX = /(id_number|secondary_id|dob|name|photo|address|phone|email|image_link|kyc_receipt|gender|expiration|issuance|first_name|last_name|middle_name)/i

const DROPPED_KEYS: ReadonlySet<string> = new Set(['signature'])

export function redactSmilePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    if (EXPLICIT_PII_KEYS.has(key) || GENERIC_PII_KEY_REGEX.test(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = redactValue(nested)
  }
  return out
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    if (EXPLICIT_PII_KEYS.has(key) || GENERIC_PII_KEY_REGEX.test(key)) {
      out[key] = REDACTED
      continue
    }
    out[key] = redactValue(nested)
  }
  return out
}
