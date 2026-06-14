/**
 * Plug-A-Pro AI operating loop — redaction & unsafe-field protection.
 *
 * Two tiers, deliberately different in consequence:
 *
 *  1. DENY tier (secrets, tokens, credentials, government IDs, biometrics,
 *     payment-card data, raw OTP/passwords). If a value for one of these keys
 *     is present, the event is REJECTED — not silently scrubbed. Failing loud
 *     forces the call site to stop passing it, which is the only durable fix.
 *
 *  2. SOFT tier (phone, email, names, addresses, free text / message bodies).
 *     These are expected in operational signal, so we keep the event but
 *     redact: phones are masked, emails masked, free text replaced with a
 *     length-only summary. Nothing raw leaves the process.
 *
 * Mirrors the proven approach in lib/application-error-service.ts (REDACT_KEYS
 * + recursive redactPayload + sha256 hashing) so the loop stays consistent with
 * the rest of the platform's PII handling.
 */

import { createHash } from 'crypto'
import { maskPhone } from '../support-diagnostics'

/** Substring matched against lower-cased keys. Presence ⇒ REJECT the event. */
export const DENY_KEY_FRAGMENTS = [
  'idnumber',
  'id_number',
  'passport',
  'permit',
  'documentnumber',
  'document_number',
  'id_document',
  'iddocument',
  'selfie',
  'biometric',
  'liveness',
  'facemap',
  'cardnumber',
  'card_number',
  'cardno',
  'cvv',
  'cvc',
  'pan',
  'password',
  'passwd',
  'otp',
  'pin',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'bearer',
  'authorization',
  'sessioncookie',
  'session_cookie',
  'cookie',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'mnemonic',
  'token', // last: broad, intentional — anything *_token / token* is denied
] as const

/** Substring matched against lower-cased keys. Presence ⇒ REDACT (keep event). */
export const SOFT_KEY_FRAGMENTS = [
  'phone',
  'msisdn',
  'whatsapp',
  'email',
  'idnum', // covered by deny too; harmless overlap
] as const

/** Keys whose values are free text that may carry message bodies / PII prose. */
export const FREE_TEXT_KEY_FRAGMENTS = [
  'body',
  'message',
  'messagebody',
  'text',
  'conversation',
  'transcript',
  'note',
  'comment',
  'caption',
  'address',
  'addressline',
  'street',
  'reason', // reasons are often pasted error text / user prose
] as const

const MAX_DEPTH = 5
const MAX_ARRAY = 20
const FREE_TEXT_MAX = 80

/** 13 consecutive digits ⇒ likely a South African ID number embedded in prose. */
const ID_NUMBER_RE = /\b\d{13}\b/g
/** Long unbroken token-ish runs (jwt/base64/hex) embedded in prose. */
const TOKEN_RE = /\b[A-Za-z0-9_\-]{32,}\b/g

function keyMatches(key: string, fragments: readonly string[]): boolean {
  const k = key.toLowerCase()
  return fragments.some((f) => k.includes(f))
}

/** Stable, non-reversible 16-char hash. Use for references, never for display. */
export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

const PHONE_LIKE_RE = /^\+?\d[\d\s()-]{6,}$/

/**
 * Make an entity / actor reference safe to store. Internal IDs (cuid, uuid)
 * pass through unchanged; anything that looks like a phone number is hashed so
 * raw MSISDNs never become references.
 */
export function safeReference(value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  if (PHONE_LIKE_RE.test(value.trim())) return `phash_${hashIdentifier(value.trim())}`
  return value
}

/** Scrub PII patterns out of an individual free-text value. */
function scrubFreeText(value: string): string {
  if (value.length > FREE_TEXT_MAX) {
    return `[text omitted: ${value.length} chars]`
  }
  return value.replace(ID_NUMBER_RE, '[redacted-id]').replace(TOKEN_RE, '[redacted-token]')
}

export interface RawSensitiveFinding {
  /** Dot path to the offending key, e.g. "identity.idNumber". */
  path: string
  /** The deny fragment that matched. */
  matched: string
}

/**
 * Walk an object and report every DENY-tier key that carries a non-empty value.
 * The writer uses this to reject events outright. Empty/null values are ignored
 * (a present-but-empty `token: ''` is not a leak).
 */
export function findRawSensitiveFields(
  input: unknown,
  basePath = '',
): RawSensitiveFinding[] {
  const findings: RawSensitiveFinding[] = []
  const walk = (obj: unknown, path: string, depth: number) => {
    if (depth > MAX_DEPTH || obj === null || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      obj.slice(0, MAX_ARRAY).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1))
      return
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      const matched = DENY_KEY_FRAGMENTS.find((f) => key.toLowerCase().includes(f))
      const hasValue = value !== null && value !== undefined && value !== ''
      if (matched && hasValue) {
        findings.push({ path: childPath, matched })
      }
      walk(value, childPath, depth + 1)
    }
  }
  walk(input, basePath, 0)
  return findings
}

export interface RedactOptions {
  /**
   * strict ⇒ unknown string values longer than FREE_TEXT_MAX are treated as
   * potential message bodies and summarised even when their key isn't a known
   * free-text key. Used for whatsapp / kyc / auth events.
   */
  strict?: boolean
}

/**
 * Produce a safe copy of arbitrary metadata. DENY keys become '[REJECTED]'
 * (defense in depth — the writer should already have rejected), SOFT keys are
 * masked, free-text keys are summarised, and embedded ID/token patterns are
 * scrubbed from every string value.
 */
export function redactMetadata(input: unknown, options: RedactOptions = {}): unknown {
  const walk = (obj: unknown, depth: number, keyHint = ''): unknown => {
    if (depth > MAX_DEPTH) return '[max-depth]'
    if (obj === null || obj === undefined) return obj
    if (typeof obj === 'string') {
      if (keyMatches(keyHint, SOFT_KEY_FRAGMENTS)) {
        return keyHint.toLowerCase().includes('email') ? maskEmail(obj) : maskPhone(obj) ?? '***'
      }
      if (keyMatches(keyHint, FREE_TEXT_KEY_FRAGMENTS)) return scrubFreeText(obj)
      if (options.strict && obj.length > FREE_TEXT_MAX) return `[text omitted: ${obj.length} chars]`
      return scrubFreeText(obj)
    }
    if (typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
      return obj.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1, keyHint))
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (keyMatches(key, DENY_KEY_FRAGMENTS)) {
        out[key] = '[REJECTED]'
      } else if (keyMatches(key, SOFT_KEY_FRAGMENTS) && typeof value === 'string') {
        out[key] = key.toLowerCase().includes('email') ? maskEmail(value) : maskPhone(value) ?? '***'
      } else {
        out[key] = walk(value, depth + 1, key)
      }
    }
    return out
  }
  return walk(input, 0)
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

export { maskPhone }
