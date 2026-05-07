-- Add Step 5 provider onboarding capture fields.
-- These are optional and backfilled from WhatsApp onboarding data only.

ALTER TABLE "provider_applications"
  ADD COLUMN IF NOT EXISTS "alternateMobileE164" TEXT,
  ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT,
  ADD COLUMN IF NOT EXISTS "reference1Name" TEXT,
  ADD COLUMN IF NOT EXISTS "reference1Mobile" TEXT,
  ADD COLUMN IF NOT EXISTS "reference2Name" TEXT,
  ADD COLUMN IF NOT EXISTS "reference2Mobile" TEXT;
