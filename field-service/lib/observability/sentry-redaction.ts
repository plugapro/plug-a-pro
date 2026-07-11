// Pure PII redaction for Sentry event payloads.
//
// This runs in BOTH the server (instrumentation.ts) and client
// (instrumentation-client.ts) Sentry `beforeSend` hooks, so it must stay pure
// and dependency-free (no db, no node-only APIs) — it is safe to bundle into
// the browser.
//
// POPIA posture (Plug A Pro handles special personal information — SA ID numbers):
// this scrubber is DEFENCE-IN-DEPTH, not the primary control. The primary
// controls are configured at each Sentry.init call site:
//   1. `sendDefaultPii: false` — Sentry attaches no IP address, cookies, or
//      user identifiers of its own.
//   2. Session Replay is intentionally NOT enabled — it would capture ID
//      documents rendered on-screen in the KYC flow (the single biggest sink).
// On top of those, this function best-effort strips the structured identifiers
// most likely to appear verbatim in an error payload (exception message,
// breadcrumb, request body): SA phone numbers, SA ID numbers, and emails.
// It cannot catch free-form PII (names, addresses); those are mitigated by the
// two primary controls above, not here.

const REDACTED = '[REDACTED]'

// South African mobile numbers in E.164-ish form: optional '+', country code 27,
// then 9 digits (e.g. +27821234567 / 27821234567).
const SA_PHONE = /\+?27\d{9}/g

// South African ID numbers: exactly 13 digits, not part of a longer digit run
// (avoids clobbering unrelated long numeric ids / timestamps).
const SA_ID = /(?<!\d)\d{13}(?!\d)/g

// Email addresses (conservative RFC-ish pattern; case-insensitive).
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

/**
 * Redact SA phone numbers, ID numbers, and emails from any string.
 * Phones are scrubbed before IDs so the 11-digit phone run can't be
 * misread as part of a 13-digit ID.
 */
export function redactPii(input: string): string {
  return input
    .replace(SA_PHONE, REDACTED)
    .replace(SA_ID, REDACTED)
    .replace(EMAIL, REDACTED)
}

/**
 * Redact PII from an entire Sentry event by round-tripping through JSON.
 * Returns the original event unchanged if serialization fails (never throws —
 * a redaction failure must not drop the error report).
 */
export function redactSentryEvent<T>(event: T): T {
  try {
    return JSON.parse(redactPii(JSON.stringify(event))) as T
  } catch {
    return event
  }
}
