-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "CaseState" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED', 'REOPENED');
CREATE TYPE "CaseEntityType" AS ENUM ('JOB_REQUEST', 'MATCH', 'BOOKING', 'PAYMENT', 'DISPUTE', 'APPLICATION');
CREATE TYPE "CaseEventType" AS ENUM (
  'STATE_CHANGE', 'SYSTEM_EVENT', 'OPS_ACTION', 'NOTE_ADDED',
  'ATTACHMENT_ADDED', 'ASSIGNMENT_CHANGE', 'CUSTOMER_CONTACTED',
  'ESCALATION', 'BREACH_DETECTED'
);
CREATE TYPE "CaseNoteVisibility" AS ENUM ('INTERNAL_ONLY');

-- ─── Case ─────────────────────────────────────────────────────────────────────

CREATE TABLE "cases" (
  "id"          TEXT NOT NULL,
  "queueType"   "OpsQueueType"   NOT NULL,
  "entityType"  "CaseEntityType" NOT NULL,
  "entityId"    TEXT             NOT NULL,
  "state"       "CaseState"      NOT NULL DEFAULT 'OPEN',
  "outcome"     TEXT,
  "reasonCode"  TEXT,
  "ownerUserId" TEXT,
  "slaDueAt"    TIMESTAMP(3)     NOT NULL,
  "resolvedAt"  TIMESTAMP(3),
  "resolvedBy"  TEXT,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cases_entityType_entityId_queueType_key"
  ON "cases"("entityType", "entityId", "queueType");

CREATE INDEX "cases_queueType_state_slaDueAt_idx"
  ON "cases"("queueType", "state", "slaDueAt");

CREATE INDEX "cases_ownerUserId_state_idx"
  ON "cases"("ownerUserId", "state");

CREATE INDEX "cases_entityId_idx"
  ON "cases"("entityId");

-- ─── CaseEvent ────────────────────────────────────────────────────────────────

CREATE TABLE "case_events" (
  "id"          TEXT NOT NULL,
  "caseId"      TEXT NOT NULL,
  "type"        "CaseEventType" NOT NULL,
  "payload"     JSONB           NOT NULL DEFAULT '{}',
  "actorUserId" TEXT,
  "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_events_caseId_createdAt_idx"
  ON "case_events"("caseId", "createdAt");

ALTER TABLE "case_events"
  ADD CONSTRAINT "case_events_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE;

-- ─── CaseNote ─────────────────────────────────────────────────────────────────

CREATE TABLE "case_notes" (
  "id"           TEXT NOT NULL,
  "caseId"       TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "visibility"   "CaseNoteVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
  "createdAt"    TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_notes_caseId_createdAt_idx"
  ON "case_notes"("caseId", "createdAt");

ALTER TABLE "case_notes"
  ADD CONSTRAINT "case_notes_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE;
