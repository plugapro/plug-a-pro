import { createHash, randomBytes } from 'crypto'

// Charset excludes visually ambiguous chars: O/0, I/1, L
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const SEGMENT_LENGTH = 4
const SEGMENT_COUNT = 2

export const VOUCHER_CODE_REGEX = /^PAP-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/

/**
 * Generates a human-readable voucher code in the format PAP-XXXX-XXXX.
 * Uses cryptographically random bytes to select characters from the unambiguous charset.
 */
export function generateVoucherCode(): string {
  const segments = Array.from({ length: SEGMENT_COUNT }, () =>
    Array.from({ length: SEGMENT_LENGTH }, () => {
      // Rejection sampling to avoid modulo bias
      let byte: number
      do { byte = randomBytes(1)[0] } while (byte >= 256 - (256 % CHARSET.length))
      return CHARSET[byte % CHARSET.length]
    }).join('')
  )
  return `PAP-${segments.join('-')}`
}

/**
 * Normalises a voucher code for consistent comparison:
 * strips whitespace, uppercases, removes dashes.
 * Call before hashing and before any display comparison.
 */
export function normalizeVoucherCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase().replace(/-/g, '')
}

/**
 * Hashes a pre-normalised voucher code for secure database storage.
 * NEVER log or return the raw code after calling this.
 */
export function hashVoucherCode(normalizedCode: string): string {
  return createHash('sha256').update(normalizedCode).digest('hex')
}

/**
 * Normalises then hashes a raw voucher code.
 * Use this everywhere a raw code needs to become a DB lookup key.
 */
export function voucherCodeToHash(rawCode: string): string {
  return hashVoucherCode(normalizeVoucherCode(rawCode))
}

export type VoucherParseResult =
  | { ok: true; canonical: string; codeHash: string }
  | { ok: false; reason: VoucherParseFailureReason }

export type VoucherParseFailureReason =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID_CHARS'
  | 'MALFORMED'

// Anything between/around the code chars that a real human might paste:
// ASCII whitespace + hyphen + underscore + dot, mid-dot, bullet, soft hyphen,
// the Unicode dash family (incl. en/em-dash, figure dash) and zero-width invisibles
// (incl. ZWSP/ZWNJ/ZWJ/BOM) commonly inserted by mobile keyboards on paste.
const VOUCHER_SEPARATORS = /[\s\-_.·•­‐-―​-‍﻿]+/g
const VOUCHER_CHARSET_REGEX = new RegExp(`^[${CHARSET}]{8}$`)
const VOUCHER_PREFIX = 'PAP'
const VOUCHER_CORE_LENGTH = SEGMENT_LENGTH * SEGMENT_COUNT // 8

/**
 * Tolerant voucher-code parser. Accepts:
 *   - canonical `PAP-XXXX-XXXX`
 *   - dashless `PAPXXXXXXXX`
 *   - suffix only `XXXXXXXX` (the `PAP-` prefix is treated as constant)
 *   - any internal whitespace / dots / hyphen-like characters between segments
 *   - any case
 *
 * Returns a canonical `PAP-XXXX-XXXX` form and the SHA-256 hash to look up in the DB.
 * Hash determinism with the existing `voucherCodeToHash` is preserved so codes already
 * issued continue to resolve.
 */
export function parseVoucherCode(raw: string): VoucherParseResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'EMPTY' }

  // Strip all separators, uppercase.
  const stripped = raw.replace(VOUCHER_SEPARATORS, '').toUpperCase()
  if (stripped.length === 0) return { ok: false, reason: 'EMPTY' }

  // Allow the PAP prefix to be present or absent - strip exactly one if it's there.
  const core = stripped.startsWith(VOUCHER_PREFIX)
    ? stripped.slice(VOUCHER_PREFIX.length)
    : stripped

  // Count code points (not UTF-16 code units) so a single typo of an emoji or other
  // multi-unit char doesn't masquerade as TOO_LONG.
  const codePointLength = [...core].length
  if (codePointLength === 0) return { ok: false, reason: 'EMPTY' }
  if (codePointLength < VOUCHER_CORE_LENGTH) return { ok: false, reason: 'TOO_SHORT' }
  if (codePointLength > VOUCHER_CORE_LENGTH) return { ok: false, reason: 'TOO_LONG' }
  if (!VOUCHER_CHARSET_REGEX.test(core)) return { ok: false, reason: 'INVALID_CHARS' }

  const canonical = `${VOUCHER_PREFIX}-${core.slice(0, SEGMENT_LENGTH)}-${core.slice(SEGMENT_LENGTH)}`
  // Defence in depth: the composed canonical must satisfy the existing canonical regex.
  if (!VOUCHER_CODE_REGEX.test(canonical)) return { ok: false, reason: 'MALFORMED' }

  return {
    ok: true,
    canonical,
    codeHash: hashVoucherCode(VOUCHER_PREFIX + core),
  }
}

export type VoucherRedemptionErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_NOT_APPROVED'
  | 'VOUCHER_NOT_FOUND'
  | 'VOUCHER_ALREADY_REDEEMED'
  | 'VOUCHER_EXPIRED'
  | 'VOUCHER_CANCELLED'
  | 'VOUCHER_MAX_REDEMPTIONS_REACHED'
  | 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN'
  // Parse-time codes: surface when the input never matched the voucher shape, so the
  // user can correct their finger-error instead of seeing the generic "invalid" message.
  | 'VOUCHER_CODE_EMPTY'
  | 'VOUCHER_CODE_TOO_SHORT'
  | 'VOUCHER_CODE_TOO_LONG'
  | 'VOUCHER_CODE_INVALID_CHARS'
  | 'VOUCHER_RATE_LIMITED'

export type VoucherRedemptionResult =
  | { ok: true; creditsAwarded: number; ledgerEntryId: string; canonical: string }
  | { ok: false; code: VoucherRedemptionErrorCode; message: string }

/** Maps a VoucherRedemptionErrorCode to a user-facing WhatsApp / PWA message. */
export function mapVoucherRedemptionErrorToMessage(code: VoucherRedemptionErrorCode): string {
  switch (code) {
    case 'VOUCHER_ALREADY_REDEEMED':
    case 'VOUCHER_MAX_REDEMPTIONS_REACHED':
      return 'That voucher has already been redeemed.'
    case 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN':
      return 'You have already redeemed a voucher for this campaign.'
    case 'VOUCHER_EXPIRED':
      return 'That voucher code has expired.'
    case 'VOUCHER_NOT_FOUND':
    case 'VOUCHER_CANCELLED':
      return 'That voucher code is invalid or unavailable. Please check the code and try again.'
    case 'PROVIDER_NOT_APPROVED':
      return 'Your profile must be approved before you can redeem a voucher.'
    case 'PROVIDER_NOT_FOUND':
      return 'Provider account not found. Please contact support.'
    case 'VOUCHER_CODE_EMPTY':
      return 'Please send your voucher code.'
    case 'VOUCHER_CODE_TOO_SHORT':
      return 'That code looks too short - voucher codes are 8 characters (like 7KQ9M2XD) or the full PAP-XXXX-XXXX.'
    case 'VOUCHER_CODE_TOO_LONG':
      return 'That code looks too long - voucher codes are 8 characters (like 7KQ9M2XD) or the full PAP-XXXX-XXXX.'
    case 'VOUCHER_CODE_INVALID_CHARS':
      return 'Voucher codes use A–Z and 2–9 only (no O, I, L, 0 or 1). Please re-check your code.'
    case 'VOUCHER_RATE_LIMITED':
      return 'Too many voucher attempts. Please wait a few minutes, then try again.'
  }
}
