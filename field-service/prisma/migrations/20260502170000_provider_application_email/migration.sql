-- Optional email captured at provider WhatsApp onboarding so admins can see
-- application-level email history independently of the eventual Provider
-- record. Additive only.
ALTER TABLE "provider_applications" ADD COLUMN IF NOT EXISTS "email" TEXT;
