ALTER TABLE "provider_applications"
ADD COLUMN "approvalWhatsappSendStartedAt" TIMESTAMP(3),
ADD COLUMN "approvalWhatsappSentAt" TIMESTAMP(3),
ADD COLUMN "approvalWhatsappExternalId" TEXT;

CREATE INDEX "provider_applications_approvalWhatsappSentAt_idx"
ON "provider_applications"("approvalWhatsappSentAt");
