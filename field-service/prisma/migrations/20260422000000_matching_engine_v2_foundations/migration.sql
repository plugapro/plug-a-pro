-- ─── Matching Engine v2 — Performance Foundations ────────────────────────────
-- Phase 1: hot-path indexes + three new tables for near real-time dispatch
--
-- P1-1: provider_live_status  — heartbeat-driven online/offline state
-- P1-2: candidate_pool        — precomputed provider index by category × zone
-- P1-2: provider_capacity     — active workload counter, double-booking guard
-- P1-3: hot-path indexes on job_requests, providers, leads, assignment_holds

-- ─── P1-3: Hot-path indexes ───────────────────────────────────────────────────

-- job_requests: cron + orchestrator both scan (status, createdAt ASC)
CREATE INDEX IF NOT EXISTS "idx_job_requests_status_created"
  ON "job_requests" ("status", "createdAt" ASC);

-- providers: candidate load always filters active + verified
CREATE INDEX IF NOT EXISTS "idx_providers_active_verified"
  ON "providers" ("active", "verified")
  WHERE "active" = true AND "verified" = true;

-- leads: active lead check on every cron iteration (skip-if-active guard)
CREATE INDEX IF NOT EXISTS "idx_leads_job_status"
  ON "leads" ("jobRequestId", "status");

-- assignment_holds: TTL expiry cron scans (expiresAt, status=ACTIVE)
CREATE INDEX IF NOT EXISTS "idx_assignment_holds_expires_status"
  ON "assignment_holds" ("expiresAt", "status")
  WHERE "status" = 'ACTIVE';

-- ─── P1-1: provider_live_status ───────────────────────────────────────────────

CREATE TABLE "provider_live_status" (
    "providerId"       TEXT         NOT NULL,
    "isOnline"         BOOLEAN      NOT NULL DEFAULT false,
    "availabilityMode" TEXT         NOT NULL DEFAULT 'OFFLINE',
    "activeJobCount"   INTEGER      NOT NULL DEFAULT 0,
    "lastHeartbeatAt"  TIMESTAMPTZ,
    "lastLocationLat"  DOUBLE PRECISION,
    "lastLocationLng"  DOUBLE PRECISION,
    "lastLocationAt"   TIMESTAMPTZ,
    "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "provider_live_status_pkey" PRIMARY KEY ("providerId")
);

ALTER TABLE "provider_live_status"
  ADD CONSTRAINT "provider_live_status_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Candidate filter: only online providers are shortlisted
CREATE INDEX "idx_pls_online"
  ON "provider_live_status" ("isOnline")
  WHERE "isOnline" = true;

-- Geo shortlist: bounding-box filter before haversine scoring
CREATE INDEX "idx_pls_location_bbox"
  ON "provider_live_status" ("lastLocationLat", "lastLocationLng")
  WHERE "isOnline" = true AND "lastLocationLat" IS NOT NULL;

-- ─── P1-2: candidate_pool ─────────────────────────────────────────────────────

CREATE TABLE "candidate_pool" (
    "id"             TEXT             NOT NULL DEFAULT gen_random_uuid(),
    "categorySlug"   TEXT             NOT NULL,
    "locationNodeId" TEXT,
    "provinceKey"    TEXT,
    "providerId"     TEXT             NOT NULL,
    "scoreBase"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastRefreshed"  TIMESTAMPTZ      NOT NULL DEFAULT now(),

    CONSTRAINT "candidate_pool_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "candidate_pool"
  ADD CONSTRAINT "candidate_pool_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidate_pool"
  ADD CONSTRAINT "candidate_pool_locationNodeId_fkey"
  FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Primary lookup: category + location node (unique — prevents duplicate entries)
CREATE UNIQUE INDEX "candidate_pool_categorySlug_locationNodeId_providerId_key"
  ON "candidate_pool" ("categorySlug", "locationNodeId", "providerId");

CREATE INDEX "idx_cp_category_location"
  ON "candidate_pool" ("categorySlug", "locationNodeId")
  WHERE "locationNodeId" IS NOT NULL;

-- Province-level fallback when no suburb/node match
CREATE INDEX "idx_cp_category_province"
  ON "candidate_pool" ("categorySlug", "provinceKey");

-- ─── P1-2: provider_capacity ──────────────────────────────────────────────────

CREATE TABLE "provider_capacity" (
    "providerId"    TEXT        NOT NULL,
    "activeHolds"   SMALLINT    NOT NULL DEFAULT 0,
    "activeJobs"    SMALLINT    NOT NULL DEFAULT 0,
    "maxConcurrent" SMALLINT    NOT NULL DEFAULT 2,
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "provider_capacity_pkey" PRIMARY KEY ("providerId")
);

ALTER TABLE "provider_capacity"
  ADD CONSTRAINT "provider_capacity_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed capacity rows for all existing active providers
INSERT INTO "provider_capacity" ("providerId", "updatedAt")
SELECT id, now() FROM "providers"
ON CONFLICT ("providerId") DO NOTHING;
