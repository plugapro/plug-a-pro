-- AlterTable
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "runningLateWhatsappSentAt" TIMESTAMP(3);
