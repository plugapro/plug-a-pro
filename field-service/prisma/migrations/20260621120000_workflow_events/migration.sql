-- CreateEnum
CREATE TYPE "WorkflowEventType" AS ENUM ('PROVIDER_APPLICATION_SUBMITTED', 'PROVIDER_PROFILE_UPDATED', 'SERVICE_REQUEST_STARTED', 'SERVICE_REQUEST_STEP_COMPLETED', 'SERVICE_REQUEST_ABANDONED', 'SERVICE_REQUEST_SUBMITTED', 'SERVICE_REQUEST_DECLINED', 'SERVICE_REQUEST_CANCELLED', 'MATCH_CREATED', 'PROVIDER_ASSIGNED', 'PROVIDER_DECLINED_REQUEST', 'CUSTOMER_ACCEPTED_MATCH', 'JOB_SCHEDULED', 'JOB_STARTED', 'JOB_COMPLETED', 'INVOICE_ISSUED', 'PAYMENT_FAILED', 'PAYMENT_COMPLETED', 'REVIEW_SUBMITTED');

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" TEXT NOT NULL,
    "eventType" "WorkflowEventType" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_events_eventType_occurredAt_idx" ON "workflow_events"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "workflow_events_entityType_entityId_idx" ON "workflow_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "workflow_events_occurredAt_idx" ON "workflow_events"("occurredAt");

