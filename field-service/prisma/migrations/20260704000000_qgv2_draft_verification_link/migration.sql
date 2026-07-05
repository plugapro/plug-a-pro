-- QGV2: draft-anchored FK on ProviderIdentityVerification.
-- Allows a verification row to be anchored to an in-progress
-- ProviderApplicationDraft before a Provider/ProviderApplication row exists.
-- Additive only — no drops or renames.
ALTER TABLE "public"."provider_identity_verifications"
  ADD COLUMN "providerApplicationDraftId" TEXT;

-- Index to support lookups by draft.
CREATE INDEX "provider_identity_verifications_providerApplicationDraftId_idx"
  ON "public"."provider_identity_verifications"("providerApplicationDraftId");

-- FK to the draft; cleared automatically when the draft is deleted.
ALTER TABLE "public"."provider_identity_verifications"
  ADD CONSTRAINT "provider_identity_verifications_providerApplicationDraftId_fkey"
  FOREIGN KEY ("providerApplicationDraftId")
  REFERENCES "public"."provider_application_drafts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
