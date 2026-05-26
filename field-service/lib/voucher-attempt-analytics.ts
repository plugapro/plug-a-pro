import { db } from './db'
import type { VoucherParseFailureReason, VoucherRedemptionErrorCode } from './vouchers'

export type VoucherRedemptionAttemptChannel = 'WHATSAPP' | 'PWA'
export type VoucherRedemptionAttemptOutcome =
  | 'SUCCESS'
  | 'PARSE_FAILED'
  | 'REDEMPTION_FAILED'
  | 'RATE_LIMITED'

export type VoucherRedemptionAttemptLengthBucket =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'EXPECTED_SUFFIX'
  | 'EXPECTED_WITH_PREFIX'
  | 'TOO_LONG'
  | 'OVERSIZE'

export type VoucherRedemptionAttemptSeparatorBucket =
  | 'NONE'
  | 'DASH'
  | 'WHITESPACE'
  | 'DOT_OR_UNDERSCORE'
  | 'UNICODE_DASH'
  | 'INVISIBLE'
  | 'MIXED'

export type VoucherRedemptionAttemptMetadata = {
  normalizedLength: number
  normalizedLengthBucket: VoucherRedemptionAttemptLengthBucket
  hadPapPrefix: boolean
  separatorBucket: VoucherRedemptionAttemptSeparatorBucket
  separatorCount: number
}

export type RecordVoucherRedemptionAttemptInput = {
  providerId: string
  channel: VoucherRedemptionAttemptChannel
  outcome: VoucherRedemptionAttemptOutcome
  rawInput: string
  redemptionErrorCode?: VoucherRedemptionErrorCode | null
  parseFailureReason?: VoucherParseFailureReason | null
  campaignCode?: string | null
  wouldRateLimit?: boolean
  rateLimited?: boolean
  createdAt?: Date
}

type VoucherRedemptionAttemptCreateData = Omit<
  RecordVoucherRedemptionAttemptInput,
  'rawInput' | 'createdAt'
> & VoucherRedemptionAttemptMetadata & {
  redemptionErrorCode?: VoucherRedemptionErrorCode
  parseFailureReason?: VoucherParseFailureReason
  campaignCode?: string
  wouldRateLimit: boolean
  rateLimited: boolean
  createdAt?: Date
}

export type VoucherRedemptionAttemptClient = {
  voucherRedemptionAttempt: {
    create(args: { data: VoucherRedemptionAttemptCreateData }): Promise<unknown>
  }
}

const VOUCHER_PREFIX = 'PAP'
const VOUCHER_CORE_LENGTH = 8
const OVERSIZE_NORMALIZED_LENGTH = 64
const SAFE_VOUCHER_SEPARATORS = /[\s\-_.\u00B7\u2022\u00AD\u2010-\u2015\u200B-\u200D\uFEFF]+/gu

/**
 * Builds only non-secret input-shape metadata for analytics.
 * Never return the raw input, canonical voucher code, normalized candidate, or hash.
 */
export function buildVoucherRedemptionAttemptMetadata(rawInput: string): VoucherRedemptionAttemptMetadata {
  const normalizedCandidate = rawInput.replace(SAFE_VOUCHER_SEPARATORS, '').toUpperCase()
  const normalizedLength = [...normalizedCandidate].length
  const hadPapPrefix = normalizedCandidate.startsWith(VOUCHER_PREFIX)
  const separatorStats = collectSeparatorStats(rawInput)

  return {
    normalizedLength,
    normalizedLengthBucket: bucketNormalizedLength(normalizedLength, hadPapPrefix),
    hadPapPrefix,
    separatorBucket: separatorStats.bucket,
    separatorCount: separatorStats.count,
  }
}

export async function recordVoucherRedemptionAttempt(
  input: RecordVoucherRedemptionAttemptInput,
  client: VoucherRedemptionAttemptClient = db as unknown as VoucherRedemptionAttemptClient,
): Promise<void> {
  const metadata = buildVoucherRedemptionAttemptMetadata(input.rawInput)
  const data: VoucherRedemptionAttemptCreateData = {
    providerId: input.providerId,
    channel: input.channel,
    outcome: input.outcome,
    ...metadata,
    wouldRateLimit: input.wouldRateLimit ?? false,
    rateLimited: input.rateLimited ?? false,
  }

  if (input.redemptionErrorCode != null) data.redemptionErrorCode = input.redemptionErrorCode
  if (input.parseFailureReason != null) data.parseFailureReason = input.parseFailureReason
  if (input.campaignCode != null) data.campaignCode = input.campaignCode
  if (input.createdAt != null) data.createdAt = input.createdAt

  try {
    await client.voucherRedemptionAttempt.create({ data })
  } catch (error) {
    console.warn('[voucher-attempt-analytics] failed to record voucher redemption attempt', {
      providerId: input.providerId,
      channel: input.channel,
      outcome: input.outcome,
      error,
    })
  }
}

function bucketNormalizedLength(
  normalizedLength: number,
  hadPapPrefix: boolean,
): VoucherRedemptionAttemptLengthBucket {
  if (normalizedLength === 0) return 'EMPTY'
  if (normalizedLength > OVERSIZE_NORMALIZED_LENGTH) return 'OVERSIZE'

  const comparableCodeLength = hadPapPrefix
    ? Math.max(0, normalizedLength - VOUCHER_PREFIX.length)
    : normalizedLength

  if (comparableCodeLength < VOUCHER_CORE_LENGTH) return 'TOO_SHORT'
  if (comparableCodeLength > VOUCHER_CORE_LENGTH) return 'TOO_LONG'
  return hadPapPrefix ? 'EXPECTED_WITH_PREFIX' : 'EXPECTED_SUFFIX'
}

function collectSeparatorStats(rawInput: string): {
  bucket: VoucherRedemptionAttemptSeparatorBucket
  count: number
} {
  const buckets = new Set<Exclude<VoucherRedemptionAttemptSeparatorBucket, 'NONE' | 'MIXED'>>()
  let count = 0

  for (const char of rawInput) {
    const bucket = separatorBucketForChar(char)
    if (bucket == null) continue
    count += 1
    buckets.add(bucket)
  }

  if (count === 0) return { bucket: 'NONE', count }
  if (buckets.size === 1) return { bucket: [...buckets][0], count }
  return { bucket: 'MIXED', count }
}

function separatorBucketForChar(
  char: string,
): Exclude<VoucherRedemptionAttemptSeparatorBucket, 'NONE' | 'MIXED'> | null {
  if (/\s/u.test(char)) return 'WHITESPACE'
  if (char === '-') return 'DASH'
  if (/[\u00AD\u2010-\u2015]/u.test(char)) return 'UNICODE_DASH'
  if (/[_\.\u00B7\u2022]/u.test(char)) return 'DOT_OR_UNDERSCORE'
  if (/[\u200B-\u200D\uFEFF]/u.test(char)) return 'INVISIBLE'
  return null
}
