CREATE TYPE "AssignmentMode" AS ENUM ('AUTO_ASSIGN', 'OPS_REVIEW');
CREATE TYPE "DispatchMode" AS ENUM ('AUTO_ASSIGN', 'OPS_REVIEW', 'MANUAL_OVERRIDE');
CREATE TYPE "DispatchDecisionStatus" AS ENUM ('RANKED', 'OFFERING', 'ASSIGNED', 'NO_MATCH', 'OVERRIDDEN', 'CANCELLED');
CREATE TYPE "MatchAttemptStage" AS ENUM ('FILTERED_OUT', 'RANKED', 'OFFERED', 'REJECTED', 'TIMED_OUT', 'ACCEPTED', 'SKIPPED', 'OVERRIDDEN');
CREATE TYPE "AssignmentResponseOutcome" AS ENUM ('ACCEPTED', 'REJECTED', 'TIMED_OUT', 'EXPIRED', 'OVERRIDDEN', 'CANCELLED');
CREATE TYPE "AssignmentHoldStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'RELEASED', 'CANCELLED');
CREATE TYPE "TechnicianCertificationStatus" AS ENUM ('SELF_DECLARED', 'EVIDENCE_UPLOADED', 'REVIEWED', 'VERIFIED', 'EXPIRED');
CREATE TYPE "TechnicianServiceAreaType" AS ENUM ('SUBURB', 'CITY', 'CUSTOM');
CREATE TYPE "TechnicianAvailabilityState" AS ENUM ('AVAILABLE', 'BUSY', 'PAUSED', 'OFFLINE');
CREATE TYPE "TechnicianScheduleItemType" AS ENUM ('BOOKING', 'BREAK', 'MANUAL_BLOCK', 'ASSIGNMENT_HOLD');
CREATE TYPE "TechnicianScheduleItemStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CANCELLED');

ALTER TABLE "providers"
  ADD COLUMN "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "completedJobsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onTimeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "acceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "maxTravelMinutes" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "lastKnownLat" DOUBLE PRECISION,
  ADD COLUMN "lastKnownLng" DOUBLE PRECISION,
  ADD COLUMN "lastKnownLocationLabel" TEXT,
  ADD COLUMN "lastKnownLocationAt" TIMESTAMP(3);

ALTER TABLE "provider_applications"
  ADD COLUMN "experience" TEXT,
  ADD COLUMN "availability" TEXT,
  ADD COLUMN "evidenceNote" TEXT;

ALTER TABLE "job_requests"
  ADD COLUMN "requestedWindowStart" TIMESTAMP(3),
  ADD COLUMN "requestedWindowEnd" TIMESTAMP(3),
  ADD COLUMN "requestedArrivalLatest" TIMESTAMP(3),
  ADD COLUMN "estimatedDurationMinutes" INTEGER,
  ADD COLUMN "requiredSkillTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "requiredCertificationCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "preferredProviderId" TEXT,
  ADD COLUMN "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'AUTO_ASSIGN',
  ADD COLUMN "latestDispatchDecisionId" TEXT;

ALTER TABLE "leads"
  ADD COLUMN "dispatchDecisionId" TEXT,
  ADD COLUMN "matchAttemptId" TEXT,
  ADD COLUMN "assignmentHoldId" TEXT;

ALTER TABLE "bookings"
  ADD COLUMN "scheduledStartAt" TIMESTAMP(3),
  ADD COLUMN "scheduledEndAt" TIMESTAMP(3);

CREATE TABLE "technician_skills" (
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

CREATE TABLE "technician_certifications" (
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

CREATE TABLE "technician_service_areas" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "areaType" "TechnicianServiceAreaType" NOT NULL DEFAULT 'SUBURB',
  "label" TEXT NOT NULL,
  "city" TEXT,
  "province" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "radiusKm" DOUBLE PRECISION,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "technician_service_areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "technician_availability" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "availabilityState" "TechnicianAvailabilityState" NOT NULL DEFAULT 'AVAILABLE',
  "nextAvailableAt" TIMESTAMP(3),
  "breakUntil" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "technician_availability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dispatch_decisions" (
  "id" TEXT NOT NULL,
  "jobRequestId" TEXT NOT NULL,
  "mode" "DispatchMode" NOT NULL,
  "status" "DispatchDecisionStatus" NOT NULL DEFAULT 'RANKED',
  "initiatedById" TEXT NOT NULL,
  "initiatedByRole" TEXT NOT NULL,
  "selectedProviderId" TEXT,
  "selectedMatchAttemptId" TEXT,
  "overrideReason" TEXT,
  "scoreWeights" JSONB NOT NULL DEFAULT '{}',
  "consideredCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "rankingSummary" JSONB,
  "filterSummary" JSONB,
  "explanation" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispatch_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "match_attempts" (
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

CREATE TABLE "assignment_holds" (
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

CREATE TABLE "technician_schedule_items" (
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

CREATE UNIQUE INDEX "technician_skills_providerId_skillTag_key" ON "technician_skills"("providerId", "skillTag");
CREATE UNIQUE INDEX "technician_certifications_providerId_certificationCode_key" ON "technician_certifications"("providerId", "certificationCode");
CREATE UNIQUE INDEX "technician_availability_providerId_key" ON "technician_availability"("providerId");
CREATE UNIQUE INDEX "dispatch_decisions_selectedMatchAttemptId_key" ON "dispatch_decisions"("selectedMatchAttemptId");
CREATE UNIQUE INDEX "match_attempts_dispatchDecisionId_providerId_key" ON "match_attempts"("dispatchDecisionId", "providerId");

CREATE INDEX "technician_service_areas_providerId_active_idx" ON "technician_service_areas"("providerId", "active");
CREATE INDEX "dispatch_decisions_jobRequestId_createdAt_idx" ON "dispatch_decisions"("jobRequestId", "createdAt");
CREATE INDEX "match_attempts_jobRequestId_rankedPosition_idx" ON "match_attempts"("jobRequestId", "rankedPosition");
CREATE INDEX "assignment_holds_jobRequestId_status_idx" ON "assignment_holds"("jobRequestId", "status");
CREATE INDEX "technician_schedule_items_providerId_startAt_endAt_idx" ON "technician_schedule_items"("providerId", "startAt", "endAt");

ALTER TABLE "job_requests"
  ADD CONSTRAINT "job_requests_preferredProviderId_fkey"
  FOREIGN KEY ("preferredProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_dispatchDecisionId_fkey"
  FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_matchAttemptId_fkey"
  FOREIGN KEY ("matchAttemptId") REFERENCES "match_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_assignmentHoldId_fkey"
  FOREIGN KEY ("assignmentHoldId") REFERENCES "assignment_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "technician_skills"
  ADD CONSTRAINT "technician_skills_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_certifications"
  ADD CONSTRAINT "technician_certifications_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_service_areas"
  ADD CONSTRAINT "technician_service_areas_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_availability"
  ADD CONSTRAINT "technician_availability_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispatch_decisions"
  ADD CONSTRAINT "dispatch_decisions_jobRequestId_fkey"
  FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatch_decisions_selectedProviderId_fkey"
  FOREIGN KEY ("selectedProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatch_decisions_selectedMatchAttemptId_fkey"
  FOREIGN KEY ("selectedMatchAttemptId") REFERENCES "match_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "match_attempts"
  ADD CONSTRAINT "match_attempts_jobRequestId_fkey"
  FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "match_attempts_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "match_attempts_dispatchDecisionId_fkey"
  FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assignment_holds"
  ADD CONSTRAINT "assignment_holds_jobRequestId_fkey"
  FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "assignment_holds_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "assignment_holds_dispatchDecisionId_fkey"
  FOREIGN KEY ("dispatchDecisionId") REFERENCES "dispatch_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "assignment_holds_matchAttemptId_fkey"
  FOREIGN KEY ("matchAttemptId") REFERENCES "match_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_schedule_items"
  ADD CONSTRAINT "technician_schedule_items_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "technician_schedule_items_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "technician_schedule_items_jobRequestId_fkey"
  FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "technician_schedule_items_assignmentHoldId_fkey"
  FOREIGN KEY ("assignmentHoldId") REFERENCES "assignment_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
