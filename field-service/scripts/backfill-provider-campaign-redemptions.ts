/**
 * backfill-provider-campaign-redemptions.ts
 *
 * Seeds the ProviderCampaignRedemption guard rows for pre-existing REDEEMED
 * vouchers that were redeemed BEFORE the provider_campaign_redemptions guard
 * existed. Without a guard row, those providers could redeem one extra voucher
 * per campaign (the per-campaign once-only check has no row to match against).
 *
 * For each PromoVoucher that is REDEEMED, has a redeemedByProviderId, and has no
 * campaignRedemption, this creates a ProviderCampaignRedemption pointing at the
 * voucher's batch campaignCode.
 *
 * Idempotent: re-running creates nothing new. The campaignRedemption-is-null
 * filter plus the UNIQUE(voucherId) constraint mean already-backfilled vouchers
 * are skipped on subsequent runs.
 *
 * Guard: UNIQUE(providerId, campaignCode) means a provider can only ever have one
 * guard row per campaign. If a provider already has a row for that campaignCode
 * (e.g. a later, post-migration redemption already created one), this voucher is
 * SKIPPED — we cannot create a second guard row for the same provider+campaign.
 *
 * Usage:
 *   npx tsx scripts/backfill-provider-campaign-redemptions.ts [--dry-run]
 *
 * Requires:
 *   DATABASE_URL
 */

import 'dotenv/config'
import { db } from '../lib/db'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`backfill-provider-campaign-redemptions — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const vouchers = await db.promoVoucher.findMany({
    where: {
      status: 'REDEEMED',
      redeemedByProviderId: { not: null },
      campaignRedemption: null,
    },
    select: {
      id: true,
      creditAmount: true,
      redeemedByProviderId: true,
      redeemedAt: true,
      batch: { select: { campaignCode: true } },
    },
    orderBy: { redeemedAt: 'asc' },
  })

  console.log(`Found ${vouchers.length} REDEEMED voucher(s) missing a guard row`)

  let created = 0
  let skipped = 0
  let failed = 0

  for (const voucher of vouchers) {
    const providerId = voucher.redeemedByProviderId
    const campaignCode = voucher.batch?.campaignCode

    if (!providerId) {
      console.log(`  SKIP  voucher=${voucher.id} — no redeemedByProviderId`)
      skipped++
      continue
    }
    if (!campaignCode) {
      console.log(`  SKIP  voucher=${voucher.id} — batch has no campaignCode`)
      skipped++
      continue
    }

    // Pre-check the UNIQUE(providerId, campaignCode): if this provider already has a
    // guard row for this campaign, we cannot create a second one.
    const existing = await db.providerCampaignRedemption.findUnique({
      where: { providerId_campaignCode: { providerId, campaignCode } },
      select: { id: true, voucherId: true },
    })
    if (existing) {
      console.log(
        `  SKIP  voucher=${voucher.id} — provider=${providerId} already has a ${campaignCode} row (voucher=${existing.voucherId})`,
      )
      skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(
        `  DRY   voucher=${voucher.id} → provider=${providerId} campaign=${campaignCode} credit=${voucher.creditAmount}`,
      )
      created++
      continue
    }

    try {
      await db.providerCampaignRedemption.create({
        data: {
          providerId,
          campaignCode,
          voucherId: voucher.id,
          creditAmount: voucher.creditAmount,
          redeemedAt: voucher.redeemedAt ?? new Date(),
        },
      })
      console.log(`  OK    voucher=${voucher.id} → provider=${providerId} campaign=${campaignCode}`)
      created++
    } catch (error) {
      // A concurrent run or a race against a live redemption can still trip the
      // unique constraint after the pre-check; treat that as a skip, not a failure.
      const code = (error as { code?: string }).code
      if (code === 'P2002') {
        console.log(
          `  SKIP  voucher=${voucher.id} — unique violation (provider=${providerId} campaign=${campaignCode} already guarded)`,
        )
        skipped++
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      console.error(`  FAIL  voucher=${voucher.id} — ${message}`)
      failed++
    }
  }

  console.log(
    `\nDone (${DRY_RUN ? 'DRY RUN' : 'LIVE'}): ${created} created, ${skipped} skipped (already has campaign row), ${failed} failed`,
  )
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
