-- Adds structured no-match diagnostics and retry/give-up policy fields to
-- DispatchDecision.
--
-- Production drift note:
-- The matching foundation migrations were marked applied in the production
-- ledger, but their matching tables/columns were absent. This migration first
-- repairs the matching runtime surface idempotently, then adds the classifier
-- fields. All statements are additive: no drops, no renames, no data rewrites.

-- ─── Enum foundations ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentMode') THEN
    CREATE TYPE "AssignmentMode" AS ENUM ('AUTO_ASSIGN', 'OPS_REVIEW');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchMode') THEN
    CREATE TYPE "DispatchMode" AS ENUM ('AUTO_ASSIGN', 'OPS_REVIEW', 'MANUAL_OVERRIDE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchDecisionStatus') THEN
    CREATE TYPE "DispatchDecisionStatus" AS ENUM ('RANKED', 'OFFERING', 'ASSIGNED', 'NO_MATCH', 'OVERRIDDEN', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MatchAttemptStage') THEN
    CREATE TYPE "MatchAttemptStage" AS ENUM ('FILTERED_OUT', 'RANKED', 'OFFERED', 'REJECTED', 'TIMED_OUT', 'ACCEPTED', 'SKIPPED', 'OVERRIDDEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentResponseOutcome') THEN
    CREATE TYPE "AssignmentResponseOutcome" AS ENUM ('ACCEPTED', 'REJECTED', 'TIMED_OUT', 'EXPIRED', 'OVERRIDDEN', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssignmentHoldStatus') THEN
    CREATE TYPE "AssignmentHoldStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'RELEASED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TechnicianCertificationStatus') THEN
    CREATE TYPE "TechnicianCertificationStatus" AS ENUM ('SELF_DECLARED', 'EVIDENCE_UPLOADED', 'REVIEWED', 'VERIFIED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TechnicianServiceAreaType') THEN
    CREATE TYPE "TechnicianServiceAreaType" AS ENUM ('SUBURB', 'CITY', 'REGION', 'RADIUS', 'CUSTOM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TechnicianAvailabilityState') THEN
    CREATE TYPE "TechnicianAvailabilityState" AS ENUM ('AVAILABLE', 'BUSY', 'PAUSED', 'OFFLINE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TechnicianScheduleItemType') THEN
    CREATE TYPE "TechnicianScheduleItemType" AS ENUM ('BOOKING', 'BREAK', 'MANUAL_BLOCK', 'ASSIGNMENT_HOLD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TechnicianScheduleItemStatus') THEN
    CREATE TYPE "TechnicianScheduleItemStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CANCELLED');
  END IF;
END $$;

ALTER TYPE "TechnicianServiceAreaType" ADD VALUE IF NOT EXISTS 'REGION';
ALTER TYPE "TechnicianServiceAreaType" ADD VALUE IF NOT EXISTS 'RADIUS';

-- ─── Columns used by intake and matching ────────────────────────────────────

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "completedJobsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "onTimeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxTravelMinutes" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "lastKnownLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lastKnownLng" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lastKnownLocationLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "lastKnownLocationAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "equipmentTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "vehicleTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "complaintCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "complaintRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "providerCancellationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancellationRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lateArrivalCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "punctualityScore" DOUBLE PRECISION NOT NULL DEFAULT 1;

ALTER TABLE "job_requests"
  ADD COLUMN IF NOT EXISTS "requestRef" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "subcategory" TEXT,
  ADD COLUMN IF NOT EXISTS "urgency" TEXT,
  ADD COLUMN IF NOT EXISTS "budgetPreference" TEXT,
  ADD COLUMN IF NOT EXISTS "maxCallOutFee" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "providerPreference" TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "certifiedProviderRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "requestedWindowStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "requestedWindowEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "requestedArrivalLatest" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estimatedDurationMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "requiredSkillTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "requiredCertificationCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "requiredEquipmentTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "requiredVehicleTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "preferredProviderId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'AUTO_ASSIGN',
  ADD COLUMN IF NOT EXISTS "customerAcceptedAmount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "customerAcceptedScope" TEXT,
  ADD COLUMN IF NOT EXISTS "autoCreateBookingOnAssignment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customerAccessToken" TEXT,
  ADD COLUMN IF NOT EXISTS "customerAccessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerAccessTokenRevokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "latestDispatchDecisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "isTestRequest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
  ADD COLUMN IF NOT EXISTS "customerNoMatchNotifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerRematchCheckSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerRematchCheckRespondedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerRematchCheckOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "altSlotNegotiationSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "altSlotNegotiationOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "matchFoundWhatsappSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enRouteWhatsappSentAt" TIMESTAMP(3);

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "dispatchDecisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "matchAttemptId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignmentHoldId" TEXT,
  ADD COLUMN IF NOT EXISTS "isTestLead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cohortName" TEXT,
  ADD COLUMN IF NOT EXISTS "notifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notificationAttemptedAt" TIMESTAMP(3);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledEndAt" TIMESTAMP(3);

-- ─── Matching runtime tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "provider_certifications" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuingAuthority" TEXT,
  "certNumber" TEXT,
  "issuedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "documentUrl" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_certifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "provider_equipment" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT,
  "serialNumber" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "technician_skills" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "skillTag" TEXT NOT NULL,
  "proficiency" INTEGER,
  "yearsExperience" DOUBLE PRECISION,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technician_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "technician_certifications" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "certificationCode" TEXT NOT NULL,
  "certificationName" TEXT NOT NULL,
  "issuingAuthority" TEXT,
  "status" "TechnicianCertificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
  "expiresAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "evidenceUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technician_certifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "technician_service_areas" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "areaType" "TechnicianServiceAreaType" NOT NULL DEFAULT 'SUBURB',
  "label" TEXT NOT NULL,
  "city" TEXT,
  "province" TEXT,
  "locationNodeId" TEXT,
  "provinceKey" TEXT,
  "cityKey" TEXT,
  "regionKey" TEXT,
  "suburbKey" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "radiusKm" DOUBLE PRECISION,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technician_service_areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "technician_availability" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "availabilityMode" TEXT NOT NULL DEFAULT 'ALWAYS_AVAILABLE',
  "availabilityState" "TechnicianAvailabilityState" NOT NULL DEFAULT 'AVAILABLE',
  "nextAvailableAt" TIMESTAMP(3),
  "breakUntil" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "pauseReason" TEXT,
  "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
  "sameDayAvailable" BOOLEAN NOT NULL DEFAULT true,
  "weekendAvailable" BOOLEAN NOT NULL DEFAULT false,
  "lastUpdatedBy" TEXT,
  "lastUpdatedChannel" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technician_availability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispatch_decisions" (
  "id" TEXT NOT NULL,
  "jobRequestId" TEXT NOT NULL,
  "mode" "DispatchMode" NOT NULL,
  "status" "DispatchDecisionStatus" NOT NULL DEFAULT 'RANKED',
  "initiatedById" TEXT NOT NULL,
  "initiatedByRole" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "selectedProviderId" TEXT,
  "selectedMatchAttemptId" TEXT,
  "overrideReason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "scoreWeights" JSONB NOT NULL DEFAULT '{}',
  "consideredCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "rankingSummary" JSONB,
  "filterSummary" JSONB,
  "explanation" TEXT,
  "alternativeSlotOptions" JSONB,
  "noMatchReason" TEXT,
  "stageCounts" JSONB,
  "failureClass" TEXT,
  "primaryReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "match_attempts" (
  "id" TEXT NOT NULL,
  "jobRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "dispatchDecisionId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "rankedPosition" INTEGER,
  "stage" "MatchAttemptStage" NOT NULL DEFAULT 'FILTERED_OUT',
  "hardFilterPassed" BOOLEAN NOT NULL DEFAULT false,
  "filteredReasonCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "feasibilityNotes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "score" DOUBLE PRECISION,
  "scoreBreakdown" JSONB,
  "offeredAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "responseOutcome" "AssignmentResponseOutcome",
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "match_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "assignment_holds" (
  "id" TEXT NOT NULL,
  "jobRequestId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "dispatchDecisionId" TEXT NOT NULL,
  "matchAttemptId" TEXT NOT NULL,
  "status" "AssignmentHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "outcomeReasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assignment_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "technician_schedule_items" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "bookingId" TEXT,
  "jobRequestId" TEXT,
  "assignmentHoldId" TEXT,
  "itemType" "TechnicianScheduleItemType" NOT NULL,
  "status" "TechnicianScheduleItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 15,
  "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 15,
  "source" TEXT NOT NULL,
  "locationLabel" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technician_schedule_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "provider_live_status" (
  "providerId" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "availabilityMode" TEXT NOT NULL DEFAULT 'OFFLINE',
  "activeJobCount" INTEGER NOT NULL DEFAULT 0,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastLocationLat" DOUBLE PRECISION,
  "lastLocationLng" DOUBLE PRECISION,
  "lastLocationAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_live_status_pkey" PRIMARY KEY ("providerId")
);

CREATE TABLE IF NOT EXISTS "candidate_pool" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "categorySlug" TEXT NOT NULL,
  "locationNodeId" TEXT,
  "provinceKey" TEXT,
  "providerId" TEXT NOT NULL,
  "scoreBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastRefreshed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidate_pool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "provider_capacity" (
  "providerId" TEXT NOT NULL,
  "activeHolds" INTEGER NOT NULL DEFAULT 0,
  "activeJobs" INTEGER NOT NULL DEFAULT 0,
  "maxConcurrent" INTEGER NOT NULL DEFAULT 2,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_capacity_pkey" PRIMARY KEY ("providerId")
);

-- Keep capacity rows available for existing providers after the repair.
INSERT INTO "provider_capacity" ("providerId", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP FROM "providers"
ON CONFLICT ("providerId") DO NOTHING;

-- ─── Add missing columns on existing matching tables ────────────────────────

ALTER TABLE "dispatch_decisions"
  ADD COLUMN IF NOT EXISTS "noMatchReason" TEXT,
  ADD COLUMN IF NOT EXISTS "stageCounts" JSONB,
  ADD COLUMN IF NOT EXISTS "failureClass" TEXT,
  ADD COLUMN IF NOT EXISTS "primaryReason" TEXT,
  ADD COLUMN IF NOT EXISTS "alternativeSlotOptions" JSONB,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "job_requests_requestRef_key" ON "job_requests"("requestRef");
CREATE UNIQUE INDEX IF NOT EXISTS "job_requests_customerAccessToken_key" ON "job_requests"("customerAccessToken");
CREATE INDEX IF NOT EXISTS "job_requests_status_createdAt_idx" ON "job_requests"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "job_requests_isTestRequest_status_idx" ON "job_requests"("isTestRequest", "status");

CREATE INDEX IF NOT EXISTS "providers_active_verified_idx" ON "providers"("active", "verified");
CREATE INDEX IF NOT EXISTS "providers_completedJobsCount_idx" ON "providers"("completedJobsCount");

CREATE INDEX IF NOT EXISTS "leads_jobRequestId_status_idx" ON "leads"("jobRequestId", "status");
CREATE INDEX IF NOT EXISTS "leads_providerId_status_idx" ON "leads"("providerId", "status");
CREATE INDEX IF NOT EXISTS "leads_isTestLead_status_idx" ON "leads"("isTestLead", "status");

CREATE INDEX IF NOT EXISTS "provider_certifications_providerId_idx" ON "provider_certifications"("providerId");
CREATE INDEX IF NOT EXISTS "provider_equipment_providerId_idx" ON "provider_equipment"("providerId");
CREATE UNIQUE INDEX IF NOT EXISTS "technician_skills_providerId_skillTag_key" ON "technician_skills"("providerId", "skillTag");
CREATE UNIQUE INDEX IF NOT EXISTS "technician_certifications_providerId_certificationCode_key" ON "technician_certifications"("providerId", "certificationCode");
CREATE UNIQUE INDEX IF NOT EXISTS "technician_availability_providerId_key" ON "technician_availability"("providerId");
CREATE INDEX IF NOT EXISTS "technician_availability_availabilityMode_idx" ON "technician_availability"("availabilityMode");
CREATE UNIQUE INDEX IF NOT EXISTS "technician_service_areas_providerId_locationNodeId_key" ON "technician_service_areas"("providerId", "locationNodeId");
CREATE INDEX IF NOT EXISTS "technician_service_areas_providerId_active_idx" ON "technician_service_areas"("providerId", "active");
CREATE INDEX IF NOT EXISTS "technician_service_areas_locationNodeId_idx" ON "technician_service_areas"("locationNodeId");
CREATE INDEX IF NOT EXISTS "technician_service_areas_provinceKey_idx" ON "technician_service_areas"("provinceKey");
CREATE INDEX IF NOT EXISTS "technician_service_areas_suburbKey_idx" ON "technician_service_areas"("suburbKey");

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_decisions_selectedMatchAttemptId_key" ON "dispatch_decisions"("selectedMatchAttemptId");
CREATE INDEX IF NOT EXISTS "dispatch_decisions_jobRequestId_createdAt_idx" ON "dispatch_decisions"("jobRequestId", "createdAt");
CREATE INDEX IF NOT EXISTS "dispatch_decisions_jobRequestId_idempotencyKey_idx" ON "dispatch_decisions"("jobRequestId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "dispatch_decisions_nextRetryAt_idx" ON "dispatch_decisions"("nextRetryAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_dispatch_decisions_job_idempotency"
  ON "dispatch_decisions" ("jobRequestId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "match_attempts_dispatchDecisionId_providerId_key" ON "match_attempts"("dispatchDecisionId", "providerId");
CREATE INDEX IF NOT EXISTS "match_attempts_jobRequestId_rankedPosition_idx" ON "match_attempts"("jobRequestId", "rankedPosition");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_assignment_holds_active_job"
  ON "assignment_holds" ("jobRequestId")
  WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "assignment_holds_jobRequestId_status_idx" ON "assignment_holds"("jobRequestId", "status");
CREATE INDEX IF NOT EXISTS "idx_assignment_holds_expires_status"
  ON "assignment_holds" ("expiresAt", "status")
  WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "technician_schedule_items_providerId_startAt_endAt_idx" ON "technician_schedule_items"("providerId", "startAt", "endAt");

CREATE INDEX IF NOT EXISTS "idx_pls_online" ON "provider_live_status"("isOnline") WHERE "isOnline" = true;
CREATE INDEX IF NOT EXISTS "idx_pls_location_bbox"
  ON "provider_live_status"("lastLocationLat", "lastLocationLng")
  WHERE "isOnline" = true AND "lastLocationLat" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_provider_live_status_heartbeat" ON "provider_live_status"("providerId", "lastHeartbeatAt");
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_pool_categorySlug_locationNodeId_providerId_key"
  ON "candidate_pool"("categorySlug", "locationNodeId", "providerId");
CREATE INDEX IF NOT EXISTS "idx_cp_category_location"
  ON "candidate_pool"("categorySlug", "locationNodeId")
  WHERE "locationNodeId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_cp_category_province" ON "candidate_pool"("categorySlug", "provinceKey");

CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_no_match_reason"
  ON "dispatch_decisions" ("noMatchReason", "createdAt")
  WHERE "noMatchReason" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_failure_class"
  ON "dispatch_decisions" ("failureClass", "createdAt")
  WHERE "failureClass" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_dispatch_decisions_primary_reason"
  ON "dispatch_decisions" ("primaryReason", "createdAt")
  WHERE "primaryReason" IS NOT NULL;

-- ─── Foreign keys ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_requests_preferredProviderId_fkey') THEN
    ALTER TABLE "job_requests"
      ADD CONSTRAINT "job_requests_preferredProviderId_fkey"
      FOREIGN KEY ("preferredProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_certifications_providerId_fkey') THEN
    ALTER TABLE "provider_certifications"
      ADD CONSTRAINT "provider_certifications_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_equipment_providerId_fkey') THEN
    ALTER TABLE "provider_equipment"
      ADD CONSTRAINT "provider_equipment_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_skills_providerId_fkey') THEN
    ALTER TABLE "technician_skills"
      ADD CONSTRAINT "technician_skills_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_certifications_providerId_fkey') THEN
    ALTER TABLE "technician_certifications"
      ADD CONSTRAINT "technician_certifications_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_service_areas_providerId_fkey') THEN
    ALTER TABLE "technician_service_areas"
      ADD CONSTRAINT "technician_service_areas_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF to_regclass('public.location_nodes') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_service_areas_locationNodeId_fkey') THEN
    ALTER TABLE "technician_service_areas"
      ADD CONSTRAINT "technician_service_areas_locationNodeId_fkey"
      FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_availability_providerId_fkey') THEN
    ALTER TABLE "technician_availability"
      ADD CONSTRAINT "technician_availability_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_decisions_jobRequestId_fkey') THEN
    ALTER TABLE "dispatch_decisions"
      ADD CONSTRAINT "dispatch_decisions_jobRequestId_fkey"
      FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_decisions_selectedProviderId_fkey') THEN
    ALTER TABLE "dispatch_decisions"
      ADD CONSTRAINT "dispatch_decisions_selectedProviderId_fkey"
      FOREIGN KEY ("selectedProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_decisions_selectedMatchAttemptId_fkey') THEN
    ALTER TABLE "dispatch_decisions"
      ADD CONSTRAINT "dispatch_decisions_selectedMatchAttemptId_fkey"
      FOREIGN KEY ("selectedMatchAttemptId") REFERENCES "match_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_attempts_jobRequestId_fkey') THEN
    ALTER TABLE "match_attempts"
      ADD CONSTRAINT "match_attempts_jobRequestId_fkey"
      FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_attempts_providerId_fkey') THEN
    ALTER TABLE "match_attempts"
      ADD CONSTRAINT "match_attempts_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_attempts_dispatchDecisionId_fkey') THEN
    ALTER TABLE "match_attempts"
      ADD CONSTRAINT "match_attempts_dispatchDecisionId_fkey"
      FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_holds_jobRequestId_fkey') THEN
    ALTER TABLE "assignment_holds"
      ADD CONSTRAINT "assignment_holds_jobRequestId_fkey"
      FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_holds_providerId_fkey') THEN
    ALTER TABLE "assignment_holds"
      ADD CONSTRAINT "assignment_holds_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_holds_dispatchDecisionId_fkey') THEN
    ALTER TABLE "assignment_holds"
      ADD CONSTRAINT "assignment_holds_dispatchDecisionId_fkey"
      FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_holds_matchAttemptId_fkey') THEN
    ALTER TABLE "assignment_holds"
      ADD CONSTRAINT "assignment_holds_matchAttemptId_fkey"
      FOREIGN KEY ("matchAttemptId") REFERENCES "match_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_schedule_items_providerId_fkey') THEN
    ALTER TABLE "technician_schedule_items"
      ADD CONSTRAINT "technician_schedule_items_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_schedule_items_bookingId_fkey') THEN
    ALTER TABLE "technician_schedule_items"
      ADD CONSTRAINT "technician_schedule_items_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_schedule_items_jobRequestId_fkey') THEN
    ALTER TABLE "technician_schedule_items"
      ADD CONSTRAINT "technician_schedule_items_jobRequestId_fkey"
      FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_schedule_items_assignmentHoldId_fkey') THEN
    ALTER TABLE "technician_schedule_items"
      ADD CONSTRAINT "technician_schedule_items_assignmentHoldId_fkey"
      FOREIGN KEY ("assignmentHoldId") REFERENCES "assignment_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_live_status_providerId_fkey') THEN
    ALTER TABLE "provider_live_status"
      ADD CONSTRAINT "provider_live_status_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_capacity_providerId_fkey') THEN
    ALTER TABLE "provider_capacity"
      ADD CONSTRAINT "provider_capacity_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidate_pool_providerId_fkey') THEN
    ALTER TABLE "candidate_pool"
      ADD CONSTRAINT "candidate_pool_providerId_fkey"
      FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF to_regclass('public.location_nodes') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidate_pool_locationNodeId_fkey') THEN
    ALTER TABLE "candidate_pool"
      ADD CONSTRAINT "candidate_pool_locationNodeId_fkey"
      FOREIGN KEY ("locationNodeId") REFERENCES "location_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_dispatchDecisionId_fkey') THEN
    ALTER TABLE "leads"
      ADD CONSTRAINT "leads_dispatchDecisionId_fkey"
      FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_matchAttemptId_fkey') THEN
    ALTER TABLE "leads"
      ADD CONSTRAINT "leads_matchAttemptId_fkey"
      FOREIGN KEY ("matchAttemptId") REFERENCES "match_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_assignmentHoldId_fkey') THEN
    ALTER TABLE "leads"
      ADD CONSTRAINT "leads_assignmentHoldId_fkey"
      FOREIGN KEY ("assignmentHoldId") REFERENCES "assignment_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── RLS for repaired public tables ─────────────────────────────────────────

ALTER TABLE "provider_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technician_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technician_certifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technician_service_areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technician_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technician_schedule_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dispatch_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_live_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_pool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_capacity" ENABLE ROW LEVEL SECURITY;
