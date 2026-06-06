-- Adds structured no-match diagnostics to DispatchDecision so ops can see WHY
-- a match was not produced (vs. just an empty filterSummary).
--
-- noMatchReason: aggregated, request-level reason code. One of:
--   INSUFFICIENT_REQUEST_DATA | NO_LOCATION_MATCH | NO_SKILL_MATCH_IN_LOCATION
--   | NO_APPROVED_PROVIDER | NO_MATCH
-- stageCounts: per-stage funnel counts (location, skill, eligible, ranked).
--
-- Additive only — no drops, no renames. Safe to deploy ahead of code rollout.
ALTER TABLE "dispatch_decisions"
  ADD COLUMN IF NOT EXISTS "noMatchReason" TEXT,
  ADD COLUMN IF NOT EXISTS "stageCounts" JSONB,
  ADD COLUMN IF NOT EXISTS "failureClass" TEXT,
  ADD COLUMN IF NOT EXISTS "primaryReason" TEXT;

-- Partial index lets ops dashboards aggregate NO_MATCH reasons cheaply without
-- scanning the full table (most rows are DISPATCHED and have NULL here).
CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_no_match_reason"
  ON "dispatch_decisions" ("noMatchReason", "createdAt")
  WHERE "noMatchReason" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_failure_class"
  ON "dispatch_decisions" ("failureClass", "createdAt")
  WHERE "failureClass" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_primary_reason"
  ON "dispatch_decisions" ("primaryReason", "createdAt")
  WHERE "primaryReason" IS NOT NULL;
