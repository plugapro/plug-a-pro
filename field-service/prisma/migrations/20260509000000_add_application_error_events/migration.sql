-- Add application_error_events table for tracking provider application submit failures.
-- Stores full technical error details internally so users only ever see a safe
-- public reference (PAP-XXXXX) rather than raw error codes, trace IDs, or
-- database constraint names.
-- Phone numbers are not stored directly — only a truncated SHA-256 hash is kept.

CREATE TABLE IF NOT EXISTS "application_error_events" (
  "id"                      TEXT NOT NULL,
  "publicErrorRef"          TEXT NOT NULL,
  "traceId"                 TEXT NOT NULL,
  "source"                  TEXT NOT NULL,
  "workflow"                TEXT NOT NULL,
  "step"                    TEXT NOT NULL,
  "userId"                  TEXT,
  "providerApplicationId"   TEXT,
  "whatsappPhoneHash"       TEXT,
  "errorCode"               TEXT NOT NULL,
  "errorCategory"           TEXT NOT NULL,
  "severity"                TEXT NOT NULL DEFAULT 'error',
  "retryable"               BOOLEAN NOT NULL DEFAULT false,
  "userSafeMessage"         TEXT NOT NULL,
  "technicalMessage"        TEXT,
  "stackTrace"              TEXT,
  "requestPayloadSummary"   JSONB,
  "responsePayloadSummary"  JSONB,
  "metadata"                JSONB NOT NULL DEFAULT '{}',
  "status"                  TEXT NOT NULL DEFAULT 'open',
  "firstSeenAt"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastSeenAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "occurrenceCount"         INTEGER NOT NULL DEFAULT 1,
  "createdAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "application_error_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "application_error_events_publicErrorRef_key"
  ON "application_error_events" ("publicErrorRef");

CREATE INDEX IF NOT EXISTS "application_error_events_traceId_idx"
  ON "application_error_events" ("traceId");

CREATE INDEX IF NOT EXISTS "application_error_events_errorCode_idx"
  ON "application_error_events" ("errorCode");

CREATE INDEX IF NOT EXISTS "application_error_events_workflow_step_idx"
  ON "application_error_events" ("workflow", "step");

CREATE INDEX IF NOT EXISTS "application_error_events_createdAt_idx"
  ON "application_error_events" ("createdAt" DESC);
