ALTER TABLE "message_events"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

-- Prevent concurrent notification triggers from sending the same outbound
-- message twice. FAILED rows are intentionally excluded so retry can reserve
-- the same logical notification again after an earlier delivery failure.
CREATE UNIQUE INDEX IF NOT EXISTS "message_events_idempotencyKey_active_key"
  ON "message_events" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL
    AND "status" IN ('QUEUED', 'SENT', 'DELIVERED', 'READ');

CREATE INDEX IF NOT EXISTS "message_events_idempotencyKey_idx"
  ON "message_events" ("idempotencyKey");
