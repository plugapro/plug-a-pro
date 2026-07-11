// Pure PII redaction for Sentry event payloads.
//
// This runs in BOTH the server (instrumentation.ts) and client
// (instrumentation-client.ts) Sentry `beforeSend` hooks, so it must stay pure
// and dependency-free (no db, no node-only APIs) — it is safe to bundle into
// the browser.
//
// Plug A Pro handles POPIA special personal information (SA ID numbers) and
// phone numbers. Error payloads (breadcrumbs, request bodies, exception
// messages) can incidentally contain these, so we scrub them before an event
// leaves the process.

const REDACTED = '[REDACTED]'

// South African mobile numbers in E.164-ish form: optional '+', country code 27,
// then 9 digits (e.g. +27821234567 / 27821234567).
const SA_PHONE = /\+?27\d{9}/g

// South African ID numbers: exactly 13 digits, not part of a longer digit run
// (avoids clobbering unrelated long numeric ids / timestamps).
const SA_ID = /(?<!\d)\d{13}(?!\d)/g

/**
 * Redact SA phone numbers and ID numbers from any string.
 * Phones are scrubbed before IDs so the 11-digit phone run can't be
 * misread as part of a 13-digit ID.
 */
export function redactPii(input: string): string {
  return input.replace(SA_PHONE, REDACTED).replace(SA_ID, REDACTED)
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
