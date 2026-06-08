const CUSTOMER_NAME_PLACEHOLDERS = new Set([
  'whatsapp customer',
  'whatsapp',
  'customer',
  'there',
])

export type ResolvedCustomerName = string | null

export function normalizeCustomerName(value?: string | null): ResolvedCustomerName {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.length < 2) return null
  if (CUSTOMER_NAME_PLACEHOLDERS.has(trimmed.toLowerCase())) return null
  return trimmed
}

// True when the value matches a known placeholder string OR its first whitespace
// token matches one. The single-token check exists because the WhatsApp onboarding
// flow writes the literal "WhatsApp Customer" into Customer.name, and read-time
// rendering used to split(' ')[0] → "WhatsApp" before this guard, producing the
// "Hi WhatsApp" greeting bug.
export function isCustomerNamePlaceholder(value?: string | null): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return true
  const lower = trimmed.toLowerCase()
  if (CUSTOMER_NAME_PLACEHOLDERS.has(lower)) return true
  const firstToken = lower.split(/\s+/)[0]
  return CUSTOMER_NAME_PLACEHOLDERS.has(firstToken)
}

// Pick the first display token to render in the greeting. Tries customer.name,
// then Supabase auth metadata (full_name → name → first_name), then null.
// Returning null lets the caller fall back to "Hi there".
export function pickCustomerDisplayFirstName(input: {
  customerName?: string | null
  authDisplayName?: string | null
}): string | null {
  const candidates: Array<string | null | undefined> = [
    input.customerName,
    input.authDisplayName,
  ]
  for (const candidate of candidates) {
    const normalized = normalizeCustomerName(candidate)
    if (!normalized) continue
    const firstToken = normalized.split(/\s+/)[0]
    if (!firstToken || isCustomerNamePlaceholder(firstToken)) continue
    return firstToken
  }
  return null
}
