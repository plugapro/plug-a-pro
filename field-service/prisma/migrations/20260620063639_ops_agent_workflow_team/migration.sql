-- CreateEnum
CREATE TYPE "OpsAgentKey" AS ENUM ('PROVIDER_APPLICATION_REVIEW', 'PROVIDER_PROFILE_COACH', 'SERVICE_REQUEST_FRICTION', 'MATCHING_JOURNEY_MONITOR', 'POST_MATCH_FOLLOW_UP', 'OPS_DAILY_BRIEFING');

-- CreateEnum
CREATE TYPE "OpsAgentRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "OpsRecommendationStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'ACTIONED', 'DISMISSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OpsRecommendationSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OpsDraftStatus" AS ENUM ('PENDING_APPROVAL', 'BLOCKED_POLICY', 'APPROVED', 'SENT', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "ops_agent_runs" (
    "id" TEXT NOT NULL,
    "agentKey" "OpsAgentKey" NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "OpsAgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "windowFrom" TIMESTAMP(3),
    "windowTo" TIMESTAMP(3),
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "recommended" INTEGER NOT NULL DEFAULT 0,
    "draftsCreated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ops_agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_recommendations" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentKey" "OpsAgentKey" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "score" INTEGER,
    "severity" "OpsRecommendationSeverity" NOT NULL DEFAULT 'MEDIUM',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL,
    "recommendedActions" JSONB NOT NULL DEFAULT '[]',
    "status" "OpsRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT NOT NULL,
    "caseId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_draft_messages" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "templateName" TEXT,
    "templateParams" JSONB NOT NULL DEFAULT '{}',
    "freeformBody" TEXT,
    "renderedPreview" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "OpsDraftStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "policyReason" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "messageEventId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_draft_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profile_scores" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "attractiveness" INTEGER NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "missingItems" JSONB NOT NULL DEFAULT '[]',
    "nudgedAt" TIMESTAMP(3),
    "improvedSinceNudge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_profile_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_friction_signals" (
    "id" TEXT NOT NULL,
    "jobRequestId" TEXT NOT NULL,
    "dropoffStage" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "detail" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_friction_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_daily_briefings" (
    "id" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "markdown" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "topFriction" JSONB NOT NULL DEFAULT '[]',
    "acquisitionPriorities" JSONB NOT NULL DEFAULT '[]',
    "openbrainRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_daily_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ops_agent_runs_agentKey_startedAt_idx" ON "ops_agent_runs"("agentKey", "startedAt");

-- CreateIndex
CREATE INDEX "ops_recommendations_agentKey_status_severity_idx" ON "ops_recommendations"("agentKey", "status", "severity");

-- CreateIndex
CREATE INDEX "ops_recommendations_entityType_entityId_idx" ON "ops_recommendations"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ops_recommendations_runId_idx" ON "ops_recommendations"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ops_recommendations_dedupeKey_key" ON "ops_recommendations"("dedupeKey");

-- CreateIndex
CREATE INDEX "ops_draft_messages_status_recipientRole_idx" ON "ops_draft_messages"("status", "recipientRole");

-- CreateIndex
CREATE INDEX "ops_draft_messages_recommendationId_idx" ON "ops_draft_messages"("recommendationId");

-- CreateIndex
CREATE INDEX "provider_profile_scores_providerId_createdAt_idx" ON "provider_profile_scores"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "request_friction_signals_dropoffStage_reasonCode_createdAt_idx" ON "request_friction_signals"("dropoffStage", "reasonCode", "createdAt");

-- CreateIndex
CREATE INDEX "request_friction_signals_jobRequestId_idx" ON "request_friction_signals"("jobRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ops_daily_briefings_forDate_key" ON "ops_daily_briefings"("forDate");

-- AddForeignKey
ALTER TABLE "ops_recommendations" ADD CONSTRAINT "ops_recommendations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ops_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ops_draft_messages" ADD CONSTRAINT "ops_draft_messages_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "ops_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profile_scores" ADD CONSTRAINT "provider_profile_scores_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_friction_signals" ADD CONSTRAINT "request_friction_signals_jobRequestId_fkey" FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

