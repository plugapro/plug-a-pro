import { db } from './db'
import { voucherCodeToHash, type VoucherRedemptionResult } from './vouchers'
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
  // Hash before any DB call — raw code must not appear in query logs
  const codeHash = voucherCodeToHash(rawCode)

  return db.$transaction(async (tx) => {
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
      include: { batch: { select: { campaignCode: true } } },
    })
    if (!voucher) {
      return { ok: false, code: 'VOUCHER_NOT_FOUND', message: 'That voucher code is invalid or unavailable.' } as const
    }

    // 3. Validate voucher state
    if (voucher.status === 'REDEEMED' || voucher.redemptionCount >= voucher.maxRedemptions) {
      return { ok: false, code: 'VOUCHER_ALREADY_REDEEMED', message: 'That voucher has already been redeemed.' } as const
    }
    if (voucher.status === 'CANCELLED') {
      return { ok: false, code: 'VOUCHER_CANCELLED', message: 'That voucher code is invalid or unavailable.' } as const
    }
    if (voucher.status === 'EXPIRED' || (voucher.expiresAt && voucher.expiresAt < new Date())) {
      return { ok: false, code: 'VOUCHER_EXPIRED', message: 'That voucher code has expired.' } as const
    }

    // 4. One-per-provider per campaign: check if this provider already redeemed any voucher from this campaign
    const existingRedemption = await tx.promoVoucher.findFirst({
      where: {
        redeemedByProviderId: providerId,
        batch: { campaignCode: voucher.batch.campaignCode },
        status: 'REDEEMED',
      },
      select: { id: true },
    })
    if (existingRedemption) {
      return { ok: false, code: 'PROVIDER_ALREADY_REDEEMED_CAMPAIGN', message: 'You have already redeemed a pilot voucher.' } as const
    }

    // 5. Atomic claim: only succeeds if the voucher is still ACTIVE.
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
        metadata: { campaignCode: voucher.batch.campaignCode },
      },
    )

    return {
      ok: true,
      creditsAwarded: voucher.creditAmount,
      ledgerEntryId: walletResult.ledgerEntries[0]?.id ?? '',
    } as const
  })
}
