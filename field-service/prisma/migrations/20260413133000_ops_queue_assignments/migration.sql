-- Create generic queue-claim records so operations can take ownership of
-- exception items without adding one-off owner fields to each domain table.

CREATE TYPE "OpsQueueType" AS ENUM (
  'VALIDATION',
  'QUOTE_APPROVAL',
  'DISPUTE',
  'PAYMENT_FOLLOW_UP',
  'PROVIDER_ONBOARDING'
);

CREATE TABLE "ops_queue_assignments" (
  "id" TEXT NOT NULL,
  "queueType" "OpsQueueType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "claimedById" TEXT,
  "claimedByRole" TEXT,
  "claimedByLabel" TEXT,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ops_queue_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ops_queue_assignments_queueType_entityId_key"
  ON "ops_queue_assignments"("queueType", "entityId");

CREATE INDEX "ops_queue_assignments_queueType_claimedById_idx"
  ON "ops_queue_assignments"("queueType", "claimedById");
