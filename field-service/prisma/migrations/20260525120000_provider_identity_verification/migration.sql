-- Provider identity verification foundation.
-- Additive only: creates verification case, document, event, review, and
-- sensitive-access audit tables used by PWA and WhatsApp verification flows.

DO $$
BEGIN
  CREATE TYPE "IdentityBasis" AS ENUM (
    'SA_ID',
    'PASSPORT',
    'REFUGEE_ID',
    'ASYLUM_PERMIT',
    'REFUGEE_PERMIT',
    'WORK_PERMIT',
    'PERMANENT_RESIDENCE_PERMIT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "IdentityDocumentKind" AS ENUM (
    'ID_FRONT',
    'ID_BACK',
    'GREEN_ID_BOOK',
    'PASSPORT_PHOTO_PAGE',
    'VISA',
    'WORK_PERMIT',
    'ASYLUM_SEEKER_PERMIT_SECTION_22',
    'REFUGEE_PERMIT_SECTION_24',
    'REFUGEE_ID',
    'SELFIE',
    'LIVENESS_FRAME'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VerificationStatus" AS ENUM (
    'NOT_STARTED',
    'STARTED',
    'CONSENTED',
    'AWAITING_IDENTIFIER',
    'AWAITING_DOCUMENT',
    'AWAITING_SELFIE',
    'SUBMITTED',
    'PROCESSING',
    'NEEDS_MANUAL_REVIEW',
    'RETRY_REQUIRED',
    'PASSED',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VerificationDecision" AS ENUM (
    'PASS',
    'FAIL',
    'MANUAL_REVIEW',
    'RETRY_REQUIRED',
    'PROVIDER_UNAVAILABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VerificationChannel" AS ENUM (
    'PWA',
    'WHATSAPP',
    'ADMIN',
    'VENDOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VerificationAssuranceLevel" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VerificationDocumentStatus" AS ENUM (
    'UPLOADED',
    'ACCEPTED',
    'REJECTED',
    'DELETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "SensitiveIdentityAccessType" AS ENUM (
    'VIEW_DOC',
    'REVEAL_IDENTIFIER',
    'SIGNED_URL_ISSUED',
    'EXPORT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "provider_identity_verifications" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "providerApplicationId" TEXT,
  "channel" "VerificationChannel" NOT NULL,
  "identityBasis" "IdentityBasis" NOT NULL,
  "issuingCountry" TEXT,
  "nationality" TEXT,
  "identifierHash" TEXT,
  "identifierLast4" TEXT,
  "identifierEncrypted" TEXT,
  "documentNumberHash" TEXT,
  "documentNumberLast4" TEXT,
  "documentExpiryDate" TIMESTAMP(3),
  "dobDerived" TIMESTAMP(3),
  "genderDerived" TEXT,
  "citizenshipDerived" TEXT,
  "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "decision" "VerificationDecision",
  "assuranceLevel" "VerificationAssuranceLevel" NOT NULL DEFAULT 'LOW',
  "riskFlags" JSONB,
  "failureReasonCode" TEXT,
  "providerNameComparisonResult" TEXT,
  "selfieMatchScore" DOUBLE PRECISION,
  "livenessScore" DOUBLE PRECISION,
  "documentConfidenceScore" DOUBLE PRECISION,
  "dhaMatchResult" TEXT,
  "immigrationStatusResult" TEXT,
  "sourceCheckProvider" TEXT,
  "rawPayloadRedacted" JSONB,
  "consentAcceptedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "auditLogReference" TEXT,
  "expiresAt" TIMESTAMP(3),
  "accessTokenHash" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "accessTokenLastUsedAt" TIMESTAMP(3),
  "accessTokenRevokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_identity_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_identity_verifications_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "provider_identity_verifications_providerApplicationId_fkey"
    FOREIGN KEY ("providerApplicationId") REFERENCES "provider_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "provider_identity_documents" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "documentKind" "IdentityDocumentKind" NOT NULL,
  "blobKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "VerificationDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "deleteAfter" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "provider_identity_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_identity_documents_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "provider_verification_events" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "fromStatus" "VerificationStatus",
  "toStatus" "VerificationStatus" NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "decision" "VerificationDecision",
  "reasonCode" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_verification_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_verification_events_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "provider_verification_reviews" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "decision" "VerificationDecision" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_verification_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_verification_reviews_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "provider_sensitive_data_access_logs" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT,
  "documentId" TEXT,
  "actorId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "accessType" "SensitiveIdentityAccessType" NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_sensitive_data_access_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_sensitive_data_access_logs_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "provider_sensitive_data_access_logs_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "provider_identity_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_identity_verifications_accessTokenHash_key"
  ON "provider_identity_verifications"("accessTokenHash");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_identifierHash_idx"
  ON "provider_identity_verifications"("identifierHash");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_documentNumberHash_idx"
  ON "provider_identity_verifications"("documentNumberHash");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_status_createdAt_idx"
  ON "provider_identity_verifications"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_providerId_idx"
  ON "provider_identity_verifications"("providerId");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_providerApplicationId_idx"
  ON "provider_identity_verifications"("providerApplicationId");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_assuranceLevel_status_idx"
  ON "provider_identity_verifications"("assuranceLevel", "status");

CREATE INDEX IF NOT EXISTS "provider_identity_documents_verificationId_idx"
  ON "provider_identity_documents"("verificationId");
CREATE INDEX IF NOT EXISTS "provider_identity_documents_deleteAfter_deletedAt_idx"
  ON "provider_identity_documents"("deleteAfter", "deletedAt");
CREATE INDEX IF NOT EXISTS "provider_identity_documents_sha256_idx"
  ON "provider_identity_documents"("sha256");

CREATE INDEX IF NOT EXISTS "provider_verification_events_verificationId_createdAt_idx"
  ON "provider_verification_events"("verificationId", "createdAt");

CREATE INDEX IF NOT EXISTS "provider_verification_reviews_verificationId_createdAt_idx"
  ON "provider_verification_reviews"("verificationId", "createdAt");
CREATE INDEX IF NOT EXISTS "provider_verification_reviews_reviewerId_createdAt_idx"
  ON "provider_verification_reviews"("reviewerId", "createdAt");

CREATE INDEX IF NOT EXISTS "provider_sensitive_data_access_logs_verificationId_createdAt_idx"
  ON "provider_sensitive_data_access_logs"("verificationId", "createdAt");
CREATE INDEX IF NOT EXISTS "provider_sensitive_data_access_logs_documentId_createdAt_idx"
  ON "provider_sensitive_data_access_logs"("documentId", "createdAt");
CREATE INDEX IF NOT EXISTS "provider_sensitive_data_access_logs_actorId_createdAt_idx"
  ON "provider_sensitive_data_access_logs"("actorId", "createdAt");

ALTER TABLE "public"."provider_identity_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_identity_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_verification_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_verification_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_sensitive_data_access_logs" ENABLE ROW LEVEL SECURITY;
