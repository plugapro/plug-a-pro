-- Add structured access-notes field on Address. Visible only after the
-- selected provider has completed final acceptance and a LeadUnlock for the
-- request's lead exists. Additive only.
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "accessNotes" TEXT;
