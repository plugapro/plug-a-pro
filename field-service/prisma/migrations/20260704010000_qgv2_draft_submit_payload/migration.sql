-- Quality gate v2 (create-on-PASS): persist a full replayable submit bundle on
-- the ProviderApplicationDraft so the identity-verification completion webhook
-- can replay the ProviderApplication/Provider submit transaction once Didit
-- returns PASS. Additive only.
ALTER TABLE "public"."provider_application_drafts" ADD COLUMN "submitPayload" JSONB;
