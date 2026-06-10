-- Additive: first-touch UTM attribution for paid campaigns (West Rand Phase 1)
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
