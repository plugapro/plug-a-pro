-- Draft-abandonment nudge tracking: track how many times a provider
-- registration draft has been nudged via WhatsApp (max 2, at 2h/24h) and
-- when the last nudge was sent, so the cron selection query (Task 7) can
-- filter out drafts that already hit the cap or were nudged too recently.
-- Additive only.
ALTER TABLE "public"."provider_application_drafts" ADD COLUMN "nudgeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."provider_application_drafts" ADD COLUMN "lastNudgeAt" TIMESTAMP(3);
