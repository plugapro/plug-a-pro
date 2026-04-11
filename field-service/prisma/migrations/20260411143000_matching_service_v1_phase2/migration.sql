-- Matching service v1 phase 2
-- Adds stronger geo coverage support, richer technician reliability metrics,
-- category operating constraints, and durable dispatch workflow fields.

ALTER TABLE "providers"
  ADD COLUMN "equipmentTags" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "vehicleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "complaintCount" INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN "complaintRate" DOUBLE PRECISION DEFAULT 0 NOT NULL,
  ADD COLUMN "providerCancellationCount" INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN "cancellationRate" DOUBLE PRECISION DEFAULT 0 NOT NULL,
  ADD COLUMN "lateArrivalCount" INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN "punctualityScore" DOUBLE PRECISION DEFAULT 1 NOT NULL;

ALTER TABLE "job_requests"
  ADD COLUMN "requiredEquipmentTags" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "requiredVehicleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
  ADD COLUMN "customerAcceptedAmount" DECIMAL(10,2),
  ADD COLUMN "customerAcceptedScope" TEXT,
  ADD COLUMN "autoCreateBookingOnAssignment" BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE "dispatch_decisions"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "retryCount" INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3);

ALTER TYPE "TechnicianServiceAreaType" ADD VALUE IF NOT EXISTS 'RADIUS';

CREATE INDEX "dispatch_decisions_jobRequestId_idempotencyKey_idx"
  ON "dispatch_decisions"("jobRequestId", "idempotencyKey");

CREATE INDEX "dispatch_decisions_nextRetryAt_idx"
  ON "dispatch_decisions"("nextRetryAt");
