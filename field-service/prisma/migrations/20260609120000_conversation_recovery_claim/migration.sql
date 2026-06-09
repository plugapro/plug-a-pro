-- Add a dedicated claim column for provider-onboarding-recovery so it stops
-- colliding with the inactivity-timeout cron's dedup guard on timeoutNotifiedAt.
-- Once session-timeout had stamped a registration conversation, every manual
-- recovery attempt was returning `recovery_skipped_locked` ("Another operator
-- or the cron is already sending this row.") forever.

ALTER TABLE "conversations"
ADD COLUMN IF NOT EXISTS "recoveryClaimedAt" TIMESTAMP(3);
