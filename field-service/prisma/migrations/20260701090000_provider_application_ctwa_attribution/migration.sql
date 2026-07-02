-- CTWA (Click-to-WhatsApp) ad attribution on provider applications.
-- Captured from the WhatsApp webhook `referral` payload on the first inbound
-- message, carried on Conversation.data, persisted at application submit.
-- Additive only.
ALTER TABLE "public"."provider_applications"
  ADD COLUMN "ctwaSourceType" TEXT,
  ADD COLUMN "ctwaSourceId" TEXT,
  ADD COLUMN "ctwaClid" TEXT,
  ADD COLUMN "ctwaHeadline" TEXT,
  ADD COLUMN "ctwaCapturedAt" TIMESTAMP(3);

-- Ad-level conversion reporting reads: applications per ad id.
CREATE INDEX "provider_applications_ctwaSourceId_idx"
  ON "public"."provider_applications"("ctwaSourceId");
