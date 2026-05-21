-- One row per (provider, campaign). The UNIQUE constraint on (providerId, campaignCode) is the
-- database-level guarantee that a provider receives credit from a given campaign at most once.
-- The application performs a pre-check and returns a user-friendly error, but the constraint is
-- the authoritative guard against concurrent duplicate awards.

CREATE TABLE "provider_campaign_redemptions" (
  "id"           TEXT        NOT NULL,
  "providerId"   TEXT        NOT NULL,
  "campaignCode" TEXT        NOT NULL,
  "voucherId"    TEXT        NOT NULL,
  "creditAmount" INTEGER     NOT NULL,
  "redeemedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "provider_campaign_redemptions_pkey"
    PRIMARY KEY ("id"),

  CONSTRAINT "provider_campaign_redemptions_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,

  CONSTRAINT "provider_campaign_redemptions_voucherId_fkey"
    FOREIGN KEY ("voucherId") REFERENCES "promo_vouchers"("id")
    ON UPDATE CASCADE ON DELETE RESTRICT,

  -- One provider may redeem from each campaign at most once.
  CONSTRAINT "provider_campaign_redemptions_providerId_campaignCode_key"
    UNIQUE ("providerId", "campaignCode"),

  -- One voucher can appear in at most one campaign redemption record.
  CONSTRAINT "provider_campaign_redemptions_voucherId_key"
    UNIQUE ("voucherId")
);

CREATE INDEX "provider_campaign_redemptions_campaignCode_idx"
  ON "provider_campaign_redemptions"("campaignCode");
