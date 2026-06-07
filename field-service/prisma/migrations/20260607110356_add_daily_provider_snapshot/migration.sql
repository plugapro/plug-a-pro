-- Daily Provider Snapshot — append-only operational metrics table.
--
-- Purpose: a Vercel cron writes one row per calendar day with aggregate
-- counts derived from provider_applications, providers,
-- provider_application_drafts, message_events, otp_delivery_attempts,
-- provider_wallets, lead_unlocks, job_requests.
--
-- Safety notes:
--   - Pure additive: CREATE TABLE only. No DROP / ALTER / DELETE on other tables.
--   - Holds only derived aggregate counts. No client PII or message bodies.
--   - Unique index on snapshotDate makes the cron idempotent (UPSERT semantics).
--   - RLS enabled with no policies — matches repo convention; bypassed by the
--     Prisma postgres role, blocks anon/authenticated PostgREST access by default.
--   - Rollback: DROP TABLE IF EXISTS "daily_provider_snapshots";
--     (no foreign keys point into this table, so drop is safe.)

CREATE TABLE "daily_provider_snapshots" (
  "id"                       TEXT NOT NULL,
  "snapshotDate"             DATE NOT NULL,
  "capturedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Application funnel (current state, prod cohort only)
  "appsApproved"             INTEGER NOT NULL DEFAULT 0,
  "appsPending"              INTEGER NOT NULL DEFAULT 0,
  "appsMoreInfo"             INTEGER NOT NULL DEFAULT 0,

  -- Provider fleet (current state, prod cohort only)
  "providersActive"          INTEGER NOT NULL DEFAULT 0,
  "providersVerified"        INTEGER NOT NULL DEFAULT 0,

  -- Pending queue health
  "pendingBreachingSla"      INTEGER NOT NULL DEFAULT 0,

  -- Approval SLA (rolling 30 days of approved providers)
  "approvalP50Minutes"       DECIMAL(10, 2),
  "approvalP90Minutes"       DECIMAL(10, 2),
  "approvalSlaHitRate"       DECIMAL(5, 4),

  -- Communication volume (rolling 30 days)
  "whatsappOutbound30d"      INTEGER NOT NULL DEFAULT 0,
  "otpAttempts30d"           INTEGER NOT NULL DEFAULT 0,

  -- Wallet state (current snapshot)
  "promoCreditsHeld"         INTEGER NOT NULL DEFAULT 0,
  "paidCreditsHeld"          INTEGER NOT NULL DEFAULT 0,

  -- Demand side and credit consumption (rolling 30 days)
  "leadUnlocks30d"           INTEGER NOT NULL DEFAULT 0,
  "jobRequests30d"           INTEGER NOT NULL DEFAULT 0,

  -- Acquisition window (rolling 7 days)
  "applicationsLast7d"       INTEGER NOT NULL DEFAULT 0,
  "approvedLast7d"           INTEGER NOT NULL DEFAULT 0,

  -- Everything else (pending age buckets, draft funnel by step, raw counts) lives here
  -- so future metrics can be added without further migrations.
  "rawMetricsJson"           JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT "daily_provider_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_provider_snapshots_snapshotDate_key"
  ON "daily_provider_snapshots"("snapshotDate");

CREATE INDEX "daily_provider_snapshots_capturedAt_idx"
  ON "daily_provider_snapshots"("capturedAt");

ALTER TABLE "public"."daily_provider_snapshots" ENABLE ROW LEVEL SECURITY;
