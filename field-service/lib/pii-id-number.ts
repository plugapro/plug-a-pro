// lib/pii-id-number.ts — pure, isomorphic idNumber helpers (SEC-01 / P0-7).
//
// No node:crypto import here on purpose: these helpers are safe to use from
// client components (e.g. the admin applications v2 view) and from scripts.
// Everything that needs the encryption key lives in lib/pii-crypto.ts.

/** Subset of ProviderApplication fields that signal an ID number was captured. */
export interface IdNumberPresenceFields {
  idNumber?: string | null
  idNumberCiphertext?: string | null
  idNumberLast4?: string | null
}

/** Strip whitespace + uppercase — mirrors lib/identity-verification/crypto.ts. */
export function normalizeIdNumber(input: string): string {
  return input.replace(/\s+/g, '').trim().toUpperCase()
}

/** Last 4 characters of the normalized identifier, for display/search without decryption. */
export function idNumberLast4(input: string): string {
  return normalizeIdNumber(input).slice(-4)
}

/**
 * True when an ID number was captured for this application, regardless of
 * whether it is stored plaintext, encrypted, or (post-retirement) as last4
 * only. All presence checks MUST use this instead of `Boolean(app.idNumber)`
 * so the manual plaintext-retirement step (scripts/retire-plaintext-id-numbers.ts)
 * cannot regress admin UX.
 */
export function hasApplicationIdNumber(app: IdNumberPresenceFields): boolean {
  return Boolean(
    (app.idNumber && app.idNumber.trim() !== '') ||
      (app.idNumberCiphertext && app.idNumberCiphertext.trim() !== '') ||
      (app.idNumberLast4 && app.idNumberLast4.trim() !== ''),
  )
}

/**
 * Masked display reference (`*********1234`) derived from last4. Returns null
 * when no last4 is available. Never exposes more than the last 4 characters.
 */
export function maskedIdNumberFromLast4(last4: string | null | undefined): string | null {
  const tail = last4?.trim()
  return tail ? `*********${tail}` : null
}
