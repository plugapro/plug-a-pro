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
  return code.trim().toUpperCase().replace(/-/g, '')
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

export type VoucherRedemptionErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_NOT_APPROVED'
  | 'VOUCHER_NOT_FOUND'
  | 'VOUCHER_ALREADY_REDEEMED'
  | 'VOUCHER_EXPIRED'
  | 'VOUCHER_CANCELLED'
  | 'VOUCHER_MAX_REDEMPTIONS_REACHED'
  | 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN'

export type VoucherRedemptionResult =
  | { ok: true; creditsAwarded: number; ledgerEntryId: string }
  | { ok: false; code: VoucherRedemptionErrorCode; message: string }

/** Maps a VoucherRedemptionErrorCode to a user-facing WhatsApp / PWA message. */
export function mapVoucherRedemptionErrorToMessage(code: VoucherRedemptionErrorCode): string {
  switch (code) {
    case 'VOUCHER_ALREADY_REDEEMED':
    case 'VOUCHER_MAX_REDEMPTIONS_REACHED':
      return 'That voucher has already been redeemed.'
    case 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN':
      return 'You have already redeemed a pilot voucher.'
    case 'VOUCHER_EXPIRED':
      return 'That voucher code has expired.'
    case 'VOUCHER_NOT_FOUND':
    case 'VOUCHER_CANCELLED':
      return 'That voucher code is invalid or unavailable. Please check the code and try again.'
    case 'PROVIDER_NOT_APPROVED':
      return 'Your profile must be approved before you can redeem a voucher.'
    case 'PROVIDER_NOT_FOUND':
      return 'Provider account not found. Please contact support.'
  }
}
