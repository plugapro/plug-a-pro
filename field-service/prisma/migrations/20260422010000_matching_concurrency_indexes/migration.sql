-- ─── Matching engine concurrency safety ──────────────────────────────────────
-- Prevents duplicate active offers for the same job request and strengthens
-- dispatch decision idempotency. All indexes are additive (no schema changes).

-- 1. At most one ACTIVE hold per job request.
--    Concurrent dispatch attempts (cron + manual + fire-and-forget) can race.
--    This partial unique index makes the DB enforce the invariant that the
--    orchestrator already checks in code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_holds_active_job
ON assignment_holds ("jobRequestId")
WHERE status = 'ACTIVE';

-- 2. Dispatch decision idempotency: prevent duplicate decisions for the same
--    (jobRequestId, idempotencyKey) combination when the key is populated.
--    orchestrateMatch() uses this to detect in-flight or completed decisions
--    and skip redundant re-dispatch.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatch_decisions_job_idempotency
ON dispatch_decisions ("jobRequestId", "idempotencyKey")
WHERE "idempotencyKey" IS NOT NULL;

-- 3. Efficient live-status filtering when heartbeat is wired.
--    Filter on (providerId, lastHeartbeatAt) so stale providers can be excluded
--    with an index seek rather than a full scan of provider_live_status.
CREATE INDEX IF NOT EXISTS idx_provider_live_status_heartbeat
ON provider_live_status ("providerId", "lastHeartbeatAt");
