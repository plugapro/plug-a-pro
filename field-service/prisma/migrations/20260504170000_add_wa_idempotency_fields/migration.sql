ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "approvalWhatsappSentAt" TIMESTAMP(3);
ALTER TABLE "job_requests" ADD COLUMN IF NOT EXISTS "matchFoundWhatsappSentAt" TIMESTAMP(3);
