-- 1. Add VOUCHER_REDEMPTION to existing WalletLedgerEntryType enum
ALTER TYPE "WalletLedgerEntryType" ADD VALUE IF NOT EXISTS 'VOUCHER_REDEMPTION';

-- 2. Create VoucherStatus enum
CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- 3. Create voucher_batches table
CREATE TABLE "voucher_batches" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "campaignCode" TEXT NOT NULL,
  "creditAmount" INTEGER NOT NULL DEFAULT 1,
  "count"        INTEGER NOT NULL,
  "expiresAt"    TIMESTAMPTZ,
  "createdById"  TEXT NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ NOT NULL,
  CONSTRAINT "voucher_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voucher_batches_campaignCode_key" UNIQUE ("campaignCode"),
  CONSTRAINT "voucher_batches_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "admin_users"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 4. Create promo_vouchers table
CREATE TABLE "promo_vouchers" (
  "id"                   TEXT NOT NULL,
  "codeHash"             TEXT NOT NULL,
  "status"               "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
  "creditAmount"         INTEGER NOT NULL DEFAULT 1,
  "maxRedemptions"       INTEGER NOT NULL DEFAULT 1,
  "redemptionCount"      INTEGER NOT NULL DEFAULT 0,
  "batchId"              TEXT NOT NULL,
  "redeemedByProviderId" TEXT,
  "redeemedByMobile"     TEXT,
  "redeemedAt"           TIMESTAMPTZ,
  "expiresAt"            TIMESTAMPTZ,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMPTZ NOT NULL,
  CONSTRAINT "promo_vouchers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promo_vouchers_codeHash_key" UNIQUE ("codeHash"),
  CONSTRAINT "promo_vouchers_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "voucher_batches"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT "promo_vouchers_redeemedByProviderId_fkey"
    FOREIGN KEY ("redeemedByProviderId") REFERENCES "providers"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

-- 5. Indexes on promo_vouchers
CREATE INDEX "promo_vouchers_status_idx"               ON "promo_vouchers"("status");
CREATE INDEX "promo_vouchers_batchId_idx"              ON "promo_vouchers"("batchId");
CREATE INDEX "promo_vouchers_redeemedByProviderId_idx" ON "promo_vouchers"("redeemedByProviderId");
CREATE INDEX "promo_vouchers_redeemedByMobile_idx"     ON "promo_vouchers"("redeemedByMobile");
CREATE INDEX "promo_vouchers_expiresAt_status_idx"     ON "promo_vouchers"("expiresAt", "status");
