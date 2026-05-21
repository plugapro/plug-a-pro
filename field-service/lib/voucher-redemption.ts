import { db } from './db'
import { voucherCodeToHash, VOUCHER_CODE_REGEX, type VoucherRedemptionResult } from './vouchers'
import { creditVoucherRedemptionInTransaction } from './provider-wallet'

/**
 * Redeems a voucher for an approved provider.
 * Shared by the WhatsApp bot and the PWA server action.
 * Do NOT duplicate this logic in either channel — call this function.
 *
 * Transaction safety:
 * - The voucher status is updated via updateMany with a WHERE status='ACTIVE' clause.
 *   If two concurrent requests both read status='ACTIVE' and both attempt updateMany,
 *   only one will get count=1. The other gets count=0 and returns VOUCHER_ALREADY_REDEEMED.
 * - All DB writes (voucher update + ledger entry) happen in a single transaction,
 *   so partial states are impossible.
 *
 * Security:
 * - rawCode is hashed before lookup. The plaintext never reaches the database.
 * - Do NOT log rawCode anywhere in this function.
 */
export async function redeemVoucher(
  providerId: string,
  rawCode: string,
): Promise<VoucherRedemptionResult> {
  // Reject garbage input before any DB call
  const normalized = rawCode.replace(/\s+/g, '').toUpperCase()
  if (!VOUCHER_CODE_REGEX.test(normalized)) {
    return { ok: false, code: 'VOUCHER_NOT_FOUND', message: 'That voucher code is invalid or unavailable.' } as const
  }

  // Hash before any DB call — raw code must not appear in query logs
  const codeHash = voucherCodeToHash(rawCode)

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

    // 4. Atomic claim: only succeeds if the voucher is still ACTIVE.
    //    count=0 means a concurrent request already redeemed it.
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

    // 5. One-per-provider-per-campaign guard — checked AFTER the atomic claim so two concurrent
    //    requests with different codes from the same campaign cannot both slip through step 4
    //    before either commits. If a duplicate is found here, roll back this voucher claim.
    const campaignDuplicate = await tx.promoVoucher.findFirst({
      where: {
        redeemedByProviderId: providerId,
        batch: { campaignCode: voucher.batch.campaignCode },
        status: 'REDEEMED',
        id: { not: voucher.id },
      },
      select: { id: true },
    })
    if (campaignDuplicate) {
      // Conditional guard prevents overwriting a legitimately-REDEEMED row in a
      // concurrent three-way race. If the voucher was already rolled back by another
      // concurrent transaction, updateMany returns count=0 and we still return the
      // correct error — no data corruption either way.
      await tx.promoVoucher.updateMany({
        where: { id: voucher.id, status: 'REDEEMED', redeemedByProviderId: providerId },
        data: {
          status: 'ACTIVE',
          redemptionCount: { decrement: 1 },
          redeemedByProviderId: null,
          redeemedByMobile: null,
          redeemedAt: null,
        },
      })
      return { ok: false, code: 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN', message: 'You have already redeemed a pilot voucher.' } as const
    }

    // 6. Credit the wallet — must happen in the same transaction
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
    return { ok: true, creditsAwarded: voucher.creditAmount, ledgerEntryId } as const
  })

  console.info('[voucher] redemption', {
    providerId,
    outcome: result.ok ? 'success' : result.code,
    creditsAwarded: result.ok ? result.creditsAwarded : undefined,
  })

  return result
}
