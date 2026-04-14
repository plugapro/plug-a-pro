-- Add timeoutNotifiedAt to conversations for inactivity timeout deduplication
ALTER TABLE "conversations" ADD COLUMN "timeoutNotifiedAt" TIMESTAMP(3);
