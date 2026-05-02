-- Qualified Shortlist foundation.
-- Additive only: existing request, lead, job, wallet, and matching data remains intact.

ALTER TABLE "job_requests"
  ADD COLUMN "requestRef" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "subcategory" TEXT,
  ADD COLUMN "urgency" TEXT,
  ADD COLUMN "budgetPreference" TEXT,
  ADD COLUMN "maxCallOutFee" DECIMAL(10,2),
  ADD COLUMN "providerPreference" TEXT,
  ADD COLUMN "verifiedOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "riskLevel" TEXT,
  ADD COLUMN "certifiedProviderRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "selectedProviderId" TEXT,
  ADD COLUMN "selectedLeadInviteId" TEXT;

ALTER TABLE "leads"
  ADD COLUMN "safePreviewToken" TEXT,
  ADD COLUMN "matchScore" DOUBLE PRECISION,
  ADD COLUMN "rankingPosition" INTEGER,
  ADD COLUMN "viewedAt" TIMESTAMP(3),
  ADD COLUMN "customerSelectedAt" TIMESTAMP(3),
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "expiredAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "jobs"
  ADD COLUMN "jobRef" TEXT,
  ADD COLUMN "selectedLeadInviteId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "scheduledArrivalAt" TIMESTAMP(3),
  ADD COLUMN "arrivalTimeConfirmedAt" TIMESTAMP(3);

CREATE TABLE "provider_categories" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "categoryId" TEXT,
  "categorySlug" TEXT NOT NULL,
  "subServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "yearsExperience" DOUBLE PRECISION,
  "skillLevel" TEXT,
  "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "certificationRequired" BOOLEAN NOT NULL DEFAULT false,
  "certificationStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_rates" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "categoryId" TEXT,
  "categorySlug" TEXT NOT NULL,
  "callOutFee" DECIMAL(10,2),
  "hourlyRate" DECIMAL(10,2),
  "dayRate" DECIMAL(10,2),
  "rateNegotiable" BOOLEAN NOT NULL DEFAULT true,
  "quoteAfterInspection" BOOLEAN NOT NULL DEFAULT false,
  "emergencySurcharge" DECIMAL(10,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_lead_responses" (
  "id" TEXT NOT NULL,
  "leadInviteId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "callOutFee" DECIMAL(10,2),
  "estimatedArrivalAt" TIMESTAMP(3),
  "rateType" TEXT,
  "rateAmount" DECIMAL(10,2),
  "negotiable" BOOLEAN NOT NULL DEFAULT true,
  "providerNote" TEXT,
  "source" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_lead_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_shortlists" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_shortlists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_shortlist_items" (
  "id" TEXT NOT NULL,
  "shortlistId" TEXT NOT NULL,
  "leadInviteId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "matchScore" DOUBLE PRECISION,
  "displayCallOutFee" DECIMAL(10,2),
  "displayArrivalTime" TIMESTAMP(3),
  "customerSelectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_shortlist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_requests_requestRef_key" ON "job_requests"("requestRef");
CREATE UNIQUE INDEX "job_requests_selectedLeadInviteId_key" ON "job_requests"("selectedLeadInviteId");
CREATE INDEX "job_requests_status_createdAt_idx" ON "job_requests"("status", "createdAt");
CREATE INDEX "job_requests_selectedProviderId_idx" ON "job_requests"("selectedProviderId");

CREATE UNIQUE INDEX "leads_safePreviewToken_key" ON "leads"("safePreviewToken");
CREATE INDEX "leads_providerId_status_idx" ON "leads"("providerId", "status");

CREATE UNIQUE INDEX "jobs_jobRef_key" ON "jobs"("jobRef");
CREATE UNIQUE INDEX "jobs_selectedLeadInviteId_key" ON "jobs"("selectedLeadInviteId");

CREATE UNIQUE INDEX "provider_categories_providerId_categorySlug_key" ON "provider_categories"("providerId", "categorySlug");
CREATE INDEX "provider_categories_categorySlug_approvalStatus_idx" ON "provider_categories"("categorySlug", "approvalStatus");

CREATE UNIQUE INDEX "provider_rates_providerId_categorySlug_key" ON "provider_rates"("providerId", "categorySlug");
CREATE INDEX "provider_rates_categorySlug_idx" ON "provider_rates"("categorySlug");

CREATE UNIQUE INDEX "provider_lead_responses_idempotencyKey_key" ON "provider_lead_responses"("idempotencyKey");
CREATE INDEX "provider_lead_responses_leadInviteId_createdAt_idx" ON "provider_lead_responses"("leadInviteId", "createdAt");
CREATE INDEX "provider_lead_responses_providerId_createdAt_idx" ON "provider_lead_responses"("providerId", "createdAt");

CREATE INDEX "provider_shortlists_requestId_status_idx" ON "provider_shortlists"("requestId", "status");

CREATE UNIQUE INDEX "provider_shortlist_items_shortlistId_leadInviteId_key" ON "provider_shortlist_items"("shortlistId", "leadInviteId");
CREATE INDEX "provider_shortlist_items_providerId_idx" ON "provider_shortlist_items"("providerId");

ALTER TABLE "job_requests"
  ADD CONSTRAINT "job_requests_selectedProviderId_fkey"
  FOREIGN KEY ("selectedProviderId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "job_requests"
  ADD CONSTRAINT "job_requests_selectedLeadInviteId_fkey"
  FOREIGN KEY ("selectedLeadInviteId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_selectedLeadInviteId_fkey"
  FOREIGN KEY ("selectedLeadInviteId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_categories"
  ADD CONSTRAINT "provider_categories_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_categories"
  ADD CONSTRAINT "provider_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_rates"
  ADD CONSTRAINT "provider_rates_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_rates"
  ADD CONSTRAINT "provider_rates_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_lead_responses"
  ADD CONSTRAINT "provider_lead_responses_leadInviteId_fkey"
  FOREIGN KEY ("leadInviteId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_lead_responses"
  ADD CONSTRAINT "provider_lead_responses_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_shortlists"
  ADD CONSTRAINT "provider_shortlists_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "job_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_shortlist_items"
  ADD CONSTRAINT "provider_shortlist_items_shortlistId_fkey"
  FOREIGN KEY ("shortlistId") REFERENCES "provider_shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_shortlist_items"
  ADD CONSTRAINT "provider_shortlist_items_leadInviteId_fkey"
  FOREIGN KEY ("leadInviteId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_shortlist_items"
  ADD CONSTRAINT "provider_shortlist_items_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
