-- Voucher redemption attempt analytics are service-side only.
-- Store safe input shape metadata, never raw voucher input, canonical codes, or code hashes.

CREATE TYPE "VoucherRedemptionAttemptChannel" AS ENUM ('WHATSAPP', 'PWA');

CREATE TYPE "VoucherRedemptionAttemptOutcome" AS ENUM (
  'SUCCESS',
  'PARSE_FAILED',
  'REDEMPTION_FAILED',
  'RATE_LIMITED'
);

CREATE TYPE "VoucherRedemptionAttemptLengthBucket" AS ENUM (
  'EMPTY',
  'TOO_SHORT',
  'EXPECTED_SUFFIX',
  'EXPECTED_WITH_PREFIX',
  'TOO_LONG',
  'OVERSIZE'
);

CREATE TYPE "VoucherRedemptionAttemptSeparatorBucket" AS ENUM (
  'NONE',
  'DASH',
  'WHITESPACE',
  'DOT_OR_UNDERSCORE',
  'UNICODE_DASH',
  'INVISIBLE',
  'MIXED'
);

CREATE TABLE "voucher_redemption_attempts" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "channel" "VoucherRedemptionAttemptChannel" NOT NULL,
  "outcome" "VoucherRedemptionAttemptOutcome" NOT NULL,
  "redemptionErrorCode" TEXT,
  "parseFailureReason" TEXT,
  "normalizedLength" INTEGER NOT NULL,
  "normalizedLengthBucket" "VoucherRedemptionAttemptLengthBucket" NOT NULL,
  "hadPapPrefix" BOOLEAN NOT NULL,
  "separatorBucket" "VoucherRedemptionAttemptSeparatorBucket" NOT NULL,
  "separatorCount" INTEGER NOT NULL DEFAULT 0,
  "campaignCode" TEXT,
  "wouldRateLimit" BOOLEAN NOT NULL DEFAULT false,
  "rateLimited" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "voucher_redemption_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voucher_redemption_attempts_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id")
    ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "voucher_redemption_attempts_createdAt_idx"
  ON "voucher_redemption_attempts"("createdAt");

CREATE INDEX "voucher_redemption_attempts_providerId_createdAt_idx"
  ON "voucher_redemption_attempts"("providerId", "createdAt");

CREATE INDEX "voucher_redemption_attempts_channel_outcome_createdAt_idx"
  ON "voucher_redemption_attempts"("channel", "outcome", "createdAt");

CREATE INDEX "voucher_redemption_attempts_parseFailureReason_createdAt_idx"
  ON "voucher_redemption_attempts"("parseFailureReason", "createdAt");

CREATE INDEX "voucher_redemption_attempts_campaignCode_createdAt_idx"
  ON "voucher_redemption_attempts"("campaignCode", "createdAt");

ALTER TABLE "public"."voucher_redemption_attempts" ENABLE ROW LEVEL SECURITY;
