import { db } from './db'
import {
  parseVoucherCode,
  type VoucherParseFailureReason,
  type VoucherRedemptionErrorCode,
  type VoucherRedemptionResult,
} from './vouchers'
import { creditVoucherRedemptionInTransaction } from './provider-wallet'
import {
  recordVoucherRedemptionAttempt,
  type VoucherRedemptionAttemptChannel,
  type VoucherRedemptionAttemptOutcome,
} from './voucher-attempt-analytics'
import { checkVoucherRedemptionLimit } from './rate-limit'

/**
 * Maps a parser failure reason to its user-facing redemption error code.
 * Kept exhaustive so adding a new parse reason becomes a compile-time prompt to map it.
 */
function parseFailureToErrorCode(reason: VoucherParseFailureReason): VoucherRedemptionErrorCode {
  switch (reason) {
    case 'EMPTY':         return 'VOUCHER_CODE_EMPTY'
    case 'TOO_SHORT':     return 'VOUCHER_CODE_TOO_SHORT'
    case 'TOO_LONG':      return 'VOUCHER_CODE_TOO_LONG'
    case 'INVALID_CHARS': return 'VOUCHER_CODE_INVALID_CHARS'
    case 'MALFORMED':     return 'VOUCHER_NOT_FOUND'
  }
}

/**
 * Redeems a voucher for an approved provider.
 * Shared by the WhatsApp bot and the PWA server action.
 * Do NOT duplicate this logic in either channel — call this function.
 *
 * Campaign uniqueness guarantee (two layers):
 * 1. Pre-check: a SELECT on provider_campaign_redemptions before any writes gives a fast,
 *    user-friendly rejection when the provider has already redeemed from this campaign.
 * 2. DB constraint: UNIQUE(providerId, campaignCode) on provider_campaign_redemptions is the
 *    authoritative guard. Two concurrent requests that both pass the pre-check will race to
 *    INSERT; the second receives a P2002 error, the transaction rolls back automatically
 *    (including the voucher claim), and the caller gets PROVIDER_ALREADY_REDEEMED_CAMPAIGN.
 *
 * Voucher-level race condition:
 * - The voucher status update uses updateMany with WHERE status='ACTIVE'.
 *   count=0 means a concurrent request already claimed it → VOUCHER_ALREADY_REDEEMED.
 *
 * Security:
 * - rawCode is hashed before lookup. The plaintext never reaches the database.
 * - Do NOT log rawCode anywhere in this function.
 */
export async function redeemVoucher(
  providerId: string,
  rawCode: string,
  context: { channel?: VoucherRedemptionAttemptChannel } = {},
): Promise<VoucherRedemptionResult> {
  // Reject garbage input before any DB call. The parser is tolerant of dashless / suffix-only /
  // em-dash / case variants so finger-errors don't silently fail at the DB-lookup stage.
  const parsed = parseVoucherCode(rawCode)
  if (!parsed.ok) {
    const code = parseFailureToErrorCode(parsed.reason)
    const limit = await evaluateVoucherAttemptLimit(providerId, 'malformed', context.channel)
    const finalCode = limit.rateLimited ? 'VOUCHER_RATE_LIMITED' : code
    await recordAttemptIfChannel({
      providerId,
      rawCode,
      channel: context.channel,
      outcome: limit.rateLimited ? 'RATE_LIMITED' : 'PARSE_FAILED',
      redemptionErrorCode: finalCode,
      parseFailureReason: parsed.reason,
      wouldRateLimit: limit.wouldRateLimit,
      rateLimited: limit.rateLimited,
    })
    return { ok: false, code: finalCode, message: voucherRateLimitedMessage(finalCode) } as const
  }

  const { canonical, codeHash } = parsed
  const parsedAttemptLimit = await evaluateVoucherAttemptLimit(providerId, 'failed', context.channel)
  if (parsedAttemptLimit.rateLimited) {
    await recordAttemptIfChannel({
      providerId,
      rawCode,
      channel: context.channel,
      outcome: 'RATE_LIMITED',
      redemptionErrorCode: 'VOUCHER_RATE_LIMITED',
      wouldRateLimit: parsedAttemptLimit.wouldRateLimit,
      rateLimited: true,
    })
    return {
      ok: false,
      code: 'VOUCHER_RATE_LIMITED',
      message: voucherRateLimitedMessage('VOUCHER_RATE_LIMITED'),
    } as const
  }

  const attemptTarget: { campaignCode?: string } = {}

  const result = await db.$transaction(async (tx) => {
    // 1. Verify provider exists and is active/approved
    const provider = await tx.provider.findUnique({
      where: { id: providerId },
      select: { id: true, phone: true, active: true, status: true },
    })
    if (!provider) {
      return { ok: false, code: 'PROVIDER_NOT_FOUND', message: 'Provider account not found.' } as const
    }
    if (!provider.active || provider.status !== 'ACTIVE') {
      return { ok: false, code: 'PROVIDER_NOT_APPROVED', message: 'Your profile must be approved before you can redeem a voucher.' } as const
    }

    // 2. Look up voucher by hash
    const voucher = await tx.promoVoucher.findUnique({
      where: { codeHash },
      include: { batch: { select: { campaignCode: true, name: true } } },
    })
    if (!voucher) {
      return { ok: false, code: 'VOUCHER_NOT_FOUND', message: 'That voucher code is invalid or unavailable.' } as const
    }
    attemptTarget.campaignCode = voucher.batch.campaignCode

    // 3. Validate voucher state — check CANCELLED before maxRedemptions to avoid information leak
    if (voucher.status === 'REDEEMED') {
      return { ok: false, code: 'VOUCHER_ALREADY_REDEEMED', message: 'That voucher has already been redeemed.' } as const
    }
    if (voucher.status === 'CANCELLED') {
      return { ok: false, code: 'VOUCHER_CANCELLED', message: 'That voucher code is invalid or unavailable.' } as const
    }
    if (voucher.redemptionCount >= voucher.maxRedemptions) {
      return { ok: false, code: 'VOUCHER_MAX_REDEMPTIONS_REACHED', message: 'That voucher code is no longer available.' } as const
    }
    if (voucher.status === 'EXPIRED' || (voucher.expiresAt && voucher.expiresAt < new Date())) {
      return { ok: false, code: 'VOUCHER_EXPIRED', message: 'That voucher code has expired.' } as const
    }

    // 4. Pre-check: fast rejection if this provider already redeemed from this campaign.
    //    The DB unique constraint (step 6) is the authoritative guard for concurrent races.
    const existingCampaignRedemption = await tx.providerCampaignRedemption.findUnique({
      where: { providerId_campaignCode: { providerId, campaignCode: voucher.batch.campaignCode } },
      select: { id: true },
    })
    if (existingCampaignRedemption) {
      return { ok: false, code: 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN', message: 'You have already redeemed a voucher for this campaign.' } as const
    }

    // 5. Atomic claim: only succeeds if the voucher is still ACTIVE.
    //    count=0 means a concurrent request already claimed it.
    const claimed = await tx.promoVoucher.updateMany({
      where: { id: voucher.id, status: 'ACTIVE' },
      data: {
        status: 'REDEEMED',
        redemptionCount: { increment: 1 },
        redeemedByProviderId: providerId,
        redeemedByMobile: provider.phone,
        redeemedAt: new Date(),
      },
    })
    if (claimed.count === 0) {
      return { ok: false, code: 'VOUCHER_ALREADY_REDEEMED', message: 'That voucher has already been redeemed.' } as const
    }

    // 6. Lock the campaign slot. The UNIQUE(providerId, campaignCode) constraint makes this the
    //    database-level safety net for concurrent requests that both passed the pre-check.
    //    If this INSERT fails with P2002, the transaction rolls back (including step 5) and the
    //    outer .catch handler converts it to PROVIDER_ALREADY_REDEEMED_CAMPAIGN.
    await tx.providerCampaignRedemption.create({
      data: {
        providerId,
        campaignCode: voucher.batch.campaignCode,
        voucherId: voucher.id,
        creditAmount: voucher.creditAmount,
      },
    })

    // 7. Credit the wallet — must happen in the same transaction
    const walletResult = await creditVoucherRedemptionInTransaction(
      tx,
      providerId,
      voucher.creditAmount,
      {
        referenceType: 'voucher',
        referenceId: voucher.id,
        description: `Voucher redemption — ${voucher.creditAmount} credit`,
        source: 'voucher_redemption',
        createdBy: 'system:voucher',
        metadata: {
          campaignCode: voucher.batch.campaignCode,
          batchName: voucher.batch.name,
        },
      },
    )

    const ledgerEntryId = walletResult.ledgerEntries[0]?.id
    if (ledgerEntryId == null) throw new Error('creditVoucherRedemptionInTransaction returned no ledger entry')
    return { ok: true, creditsAwarded: voucher.creditAmount, ledgerEntryId, canonical } as const
  }).catch((error: unknown) => {
    // A P2002 on the campaign slot (step 6) means two concurrent requests both passed the
    // pre-check and both claimed separate vouchers, but only one can hold the campaign slot.
    // PostgreSQL rolls back this transaction automatically — the voucher claim from step 5 is
    // undone — and we return the same user-facing error as the pre-check.
    if (isCampaignSlotConflict(error)) {
      console.info('[voucher] campaign slot conflict — concurrent duplicate rejected', { providerId })
      return { ok: false, code: 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN', message: 'You have already redeemed a voucher for this campaign.' } as const
    }
    throw error
  })

  if (!result.ok) {
    await recordAttemptIfChannel({
      providerId,
      rawCode,
      channel: context.channel,
      outcome: 'REDEMPTION_FAILED',
      redemptionErrorCode: result.code,
      campaignCode: attemptTarget.campaignCode,
      wouldRateLimit: parsedAttemptLimit.wouldRateLimit,
      rateLimited: false,
    })
    console.info('[voucher] redemption', {
      providerId,
      outcome: result.code,
      creditsAwarded: undefined,
    })
    return result
  }

  await recordAttemptIfChannel({
    providerId,
    rawCode,
    channel: context.channel,
    outcome: 'SUCCESS',
    campaignCode: attemptTarget.campaignCode,
    wouldRateLimit: parsedAttemptLimit.wouldRateLimit,
    rateLimited: false,
  })

  console.info('[voucher] redemption', {
    providerId,
    outcome: 'success',
    creditsAwarded: result.creditsAwarded,
  })

  return result
}

type VoucherLimitReason = 'malformed' | 'failed'

async function evaluateVoucherAttemptLimit(
  providerId: string,
  reason: VoucherLimitReason,
  channel?: VoucherRedemptionAttemptChannel,
): Promise<{ wouldRateLimit: boolean; rateLimited: boolean }> {
  if (!channel) return { wouldRateLimit: false, rateLimited: false }
  const decision = await checkVoucherRedemptionLimit({ providerId, reason })
  const wouldRateLimit = !decision.ok && decision.code === 'rate_limited'
  const enforcementEnabled = process.env.VOUCHER_RATE_LIMIT_ENFORCEMENT === 'true'
  return {
    wouldRateLimit,
    rateLimited: enforcementEnabled && !decision.ok,
  }
}

async function recordAttemptIfChannel(params: {
  providerId: string
  rawCode: string
  channel?: VoucherRedemptionAttemptChannel
  outcome: VoucherRedemptionAttemptOutcome
  redemptionErrorCode?: VoucherRedemptionErrorCode
  parseFailureReason?: VoucherParseFailureReason
  campaignCode?: string
  wouldRateLimit: boolean
  rateLimited: boolean
}): Promise<void> {
  if (!params.channel) return
  await recordVoucherRedemptionAttempt({
    providerId: params.providerId,
    channel: params.channel,
    outcome: params.outcome,
    rawInput: params.rawCode,
    redemptionErrorCode: params.redemptionErrorCode,
    parseFailureReason: params.parseFailureReason,
    campaignCode: params.campaignCode,
    wouldRateLimit: params.wouldRateLimit,
    rateLimited: params.rateLimited,
  })
}

function voucherRateLimitedMessage(code: VoucherRedemptionErrorCode): string {
  if (code === 'VOUCHER_RATE_LIMITED') {
    return 'Too many voucher attempts. Please wait a few minutes, then try again.'
  }
  return 'That voucher code is invalid or unavailable.'
}

/** Returns true when the error is a Prisma P2002 on the provider_campaign_redemptions campaign slot. */
function isCampaignSlotConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  if (e['code'] !== 'P2002') return false
  const target = (e['meta'] as Record<string, unknown> | undefined)?.['target']
  return Array.isArray(target) && (target as string[]).includes('campaignCode')
}
