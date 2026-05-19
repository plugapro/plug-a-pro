const CUSTOMER_NAME_PLACEHOLDERS = new Set([
  'whatsapp customer',
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
