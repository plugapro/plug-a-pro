import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalise a phone number to E.164 format for deduplication and identity
 * comparisons.
 *
 * SECURITY: this function is used at the WhatsApp webhook trust boundary
 * (normalizePhone(message.from)) to decide which conversation, customer and
 * provider records an inbound sender controls. WhatsApp sender values are
 * attacker-controlled and are always delivered as country-code digits without
 * a leading '+'. We therefore keep this STRICT and never interpret a bare
 * national-format (9-digit) value as a South African +27 number — doing so
 * would let a spoofed/mis-routed 9-digit sender alias an existing +27 account.
 *
 * - Strips whitespace, hyphens and a leading `whatsapp:` scheme
 * - `+xxxxxxxx` is already E.164 → returned as-is
 * - `00<cc>…` international access prefix → `+<cc>…`
 * - `0xx…` SA national trunk format (10 digits) → `+27xx…`
 * - `27xxxxxxxxx` (11 digits, how WhatsApp delivers SA numbers) → `+27…`
 *
 * For ambiguous, user-entered national input (e.g. `823035070` without the
 * leading 0) use {@link saLocalPhoneToE164} on the form-input path only. Do NOT
 * route that heuristic through normalizePhone.
 */
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/^whatsapp:/i, '').replace(/[\s\-()]/g, '')
  if (stripped.startsWith('+')) return stripped
  // International access prefix format: 0027xxxxxxxxx -> +27xxxxxxxxx.
  if (stripped.startsWith('00') && stripped.length > 4) {
    return `+${stripped.slice(2)}`
  }
  // South African local format: 0xx → +27xx
  if (stripped.startsWith('0') && stripped.length === 10) {
    return `+27${stripped.slice(1)}`
  }
  // WhatsApp delivers SA numbers without + prefix: 27xxxxxxxxx (11 digits)
  if (stripped.startsWith('27') && stripped.length === 11) {
    return `+${stripped}`
  }
  // Fallback: return stripped (caller should validate E.164 separately).
  // NOTE: a bare 9-digit national number is intentionally NOT coerced to +27
  // here. Use saLocalPhoneToE164() for trusted, user-entered form input.
  return stripped
}

/**
 * Lenient SA-local phone parser for TRUSTED, user-entered form input only
 * (admin console, imports, signup forms). Accepts the ambiguous bare 9-digit
 * national format (`823035070`) and prepends `+27`, in addition to everything
 * {@link normalizePhone} already handles.
 *
 * MUST NOT be used at the WhatsApp webhook trust boundary or anywhere the phone
 * value is attacker-controlled, because the 9-digit heuristic can alias
 * accounts. Inbound WhatsApp sender normalisation stays strict via
 * normalizePhone().
 */
export function saLocalPhoneToE164(raw: string): string {
  const stripped = raw.replace(/^whatsapp:/i, '').replace(/[\s\-()]/g, '')
  // Bare 9-digit SA mobile national number (no leading 0): 823035070 → +27823035070.
  if (/^[6-8]\d{8}$/.test(stripped)) {
    return `+27${stripped}`
  }
  return normalizePhone(raw)
}

export function phoneLookupVariants(phone: string) {
  const normalized = normalizePhone(phone)
  const digits = normalized.replace(/\D/g, '')
  const local = digits.startsWith('27') ? `0${digits.slice(2)}` : null
  const internationalPrefix = digits.startsWith('27') ? `00${digits}` : null
  return Array.from(
    new Set([normalized, digits ? `+${digits}` : null, digits || null, local, internationalPrefix].filter(Boolean) as string[]),
  )
}

/** Returns a short human-readable age string relative to now ("3m ago", "2h ago", "5d ago"). */
export function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
