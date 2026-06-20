-- Additive: extended marketing attribution for Google Ads / Meta CAPI / SEO readiness.
-- Slice B of the Marketing Acquisition Readiness brief
-- (docs/superpowers/plans/2026-06-20-marketing-acquisition-readiness.md).
--
-- - Click IDs from paid ad networks (Google Ads, Meta, Microsoft)
-- - Entry context (referrer, landing path)
-- - First/last touch timestamps
-- - Full snapshot blob for forward-compat (attribution Jsonb)
-- - Customer-level first-touch stamping for cohort/audience attribution

ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "gclid" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "gbraid" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "wbraid" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "fbclid" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "msclkid" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "referrer" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "landingPath" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "firstTouchAt" TIMESTAMP(3);
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "lastTouchAt" TIMESTAMP(3);
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "attribution" JSONB;

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchSource" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchMedium" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchCampaign" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchGclid" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchFbclid" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchAt" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchLandingPath" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "firstTouchReferrer" TEXT;
