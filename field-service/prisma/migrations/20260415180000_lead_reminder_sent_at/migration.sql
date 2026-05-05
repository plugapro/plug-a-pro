-- Add reminderSentAt to Lead: tracks when the 1-hour follow-up WhatsApp was sent.
-- Prevents the cron from re-sending reminders on every subsequent run.
ALTER TABLE "leads" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
