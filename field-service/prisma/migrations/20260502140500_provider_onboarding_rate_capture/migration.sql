-- Provider onboarding rate capture.
-- Additive only: applications without rates remain valid.

ALTER TABLE "provider_applications"
  ADD COLUMN "callOutFee" DECIMAL(10,2),
  ADD COLUMN "hourlyRate" DECIMAL(10,2),
  ADD COLUMN "rateNegotiable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "quoteAfterInspection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sameDayJobs" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "weekendJobs" BOOLEAN NOT NULL DEFAULT false;
