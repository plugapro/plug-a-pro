// Didit webhook signature verification.
//
// Didit emits three signature headers simultaneously:
//   X-Signature-V2     — HMAC-SHA256 over canonical JSON of the body  (PRIMARY)
//   X-Signature        — HMAC-SHA256 over the raw request bytes       (fallback)
//   X-Signature-Simple — HMAC-SHA256 over "<ts>:<sid>:<status>:<type>" (last resort)
//
// Plus X-Timestamp (unix-epoch seconds) for replay protection — reject if the
// skew exceeds 300 seconds.
//
// We accept V2 first, fall back to raw V1 if V2 absent. Simple is intentionally
// not implemented in v1; if Didit ever drops V1/V2 we can add it then.
//
// All known secrets (DIDIT_WEBHOOK_SECRET supports comma-separated rotation
// values) are tried in turn so a rotation window doesn't drop messages.

import { createHmac, timingSafeEqual } from 'crypto'
import { getDiditConfig } from './config'

const MAX_TIMESTAMP_SKEW_SECONDS = 300
const FUTURE_TIMESTAMP_SKEW_SECONDS = 60

export type DiditSignatureCheck = {
  valid: boolean
  reason?: 'no_secret' | 'no_timestamp' | 'stale' | 'future_skew' | 'no_signature_headers' | 'signature_mismatch'
  algorithm?: 'V2_CANONICAL' | 'V1_RAW'
}

export function verifyDiditWebhookSignature(rawBody: string, headers: Record<string, string>): DiditSignatureCheck {
  const config = getDiditConfig()
  if (!config.enabled || config.webhookSecrets.length === 0) {
    return { valid: false, reason: 'no_secret' }
  }

  const timestampHeader = headerCaseInsensitive(headers, 'x-timestamp')
  if (!timestampHeader) return { valid: false, reason: 'no_timestamp' }
  const skew = timestampSkewSeconds(timestampHeader)
  if (skew === null) return { valid: false, reason: 'no_timestamp' }
  if (skew > MAX_TIMESTAMP_SKEW_SECONDS) return { valid: false, reason: 'stale' }
  if (skew < -FUTURE_TIMESTAMP_SKEW_SECONDS) return { valid: false, reason: 'future_skew' }

  const v2 = headerCaseInsensitive(headers, 'x-signature-v2')
  const v1 = headerCaseInsensitive(headers, 'x-signature')
  if (!v2 && !v1) return { valid: false, reason: 'no_signature_headers' }

  if (v2) {
    const canonical = canonicalJson(rawBody)
    if (matchesAnySecret(canonical, v2, config.webhookSecrets)) {
      return { valid: true, algorithm: 'V2_CANONICAL' }
    }
  }
  if (v1) {
    if (matchesAnySecret(rawBody, v1, config.webhookSecrets)) {
      return { valid: true, algorithm: 'V1_RAW' }
    }
  }
  return { valid: false, reason: 'signature_mismatch' }
}

function matchesAnySecret(message: string, providedHex: string, secrets: string[]): boolean {
  const provided = decodeHex(providedHex)
  if (!provided) return false
  for (const secret of secrets) {
    let expected: Buffer
    try {
      expected = createHmac('sha256', secret).update(message, 'utf8').digest()
    } catch {
      continue
    }
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return true
    }
  }
  return false
}

function decodeHex(value: string): Buffer | null {
  const trimmed = value.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(trimmed) || trimmed.length % 2 !== 0) return null
  try {
    return Buffer.from(trimmed, 'hex')
  } catch {
    return null
  }
}

function timestampSkewSeconds(timestampHeader: string): number | null {
  const trimmed = timestampHeader.trim()
  if (!trimmed) return null
  const ts = Number(trimmed)
  if (!Number.isFinite(ts) || ts <= 0) return null
  const nowSeconds = Date.now() / 1000
  return nowSeconds - ts
}

function headerCaseInsensitive(headers: Record<string, string>, key: string): string | null {
  const target = key.toLowerCase()
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === target && typeof value === 'string' && value) return value
  }
  return null
}

// Canonical JSON (sorted keys recursively) — must match Didit's V2 hash input.
export function canonicalJson(rawBody: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return rawBody
  }
  return JSON.stringify(sortKeys(parsed))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sortKeys(v)]),
  )
}
