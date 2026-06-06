CREATE TABLE "provider_application_drafts" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT,
  "businessName" TEXT,
  "preferredContact" TEXT,
  "identityBasis" TEXT,
  "profilePhotoUrl" TEXT,
  "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "categorySlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "serviceAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "locationNodeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "experience" TEXT,
  "bio" TEXT,
  "availability" TEXT,
  "availabilityDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "availabilityHours" TEXT,
  "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
  "callOutFee" DECIMAL(10,2),
  "travelRadiusKm" INTEGER,
  "evidenceFileUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidenceNote" TEXT,
  "reference1Name" TEXT,
  "reference1Mobile" TEXT,
  "reference2Name" TEXT,
  "reference2Mobile" TEXT,
  "consentAt" TIMESTAMP(3),
  "lastCompletedStep" INTEGER NOT NULL DEFAULT 0,
  "submittedApplicationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_application_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registration_resume_tokens" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "applicationId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_resume_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_application_drafts_submittedApplicationId_key" ON "provider_application_drafts"("submittedApplicationId");
CREATE INDEX "provider_application_drafts_phone_idx" ON "provider_application_drafts"("phone");
CREATE INDEX "provider_application_drafts_submittedApplicationId_idx" ON "provider_application_drafts"("submittedApplicationId");

CREATE UNIQUE INDEX "registration_resume_tokens_tokenHash_key" ON "registration_resume_tokens"("tokenHash");
CREATE INDEX "registration_resume_tokens_tokenHash_idx" ON "registration_resume_tokens"("tokenHash");
CREATE INDEX "registration_resume_tokens_draftId_idx" ON "registration_resume_tokens"("draftId");
CREATE INDEX "registration_resume_tokens_applicationId_idx" ON "registration_resume_tokens"("applicationId");

ALTER TABLE "provider_application_drafts"
  ADD CONSTRAINT "provider_application_drafts_submittedApplicationId_fkey"
  FOREIGN KEY ("submittedApplicationId") REFERENCES "provider_applications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "registration_resume_tokens"
  ADD CONSTRAINT "registration_resume_tokens_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "provider_application_drafts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "registration_resume_tokens"
  ADD CONSTRAINT "registration_resume_tokens_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "provider_applications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
