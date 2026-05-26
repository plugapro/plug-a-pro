-- Provider-agnostic identity verification automation.
-- Additive except for making security_events.phoneE164 nullable so curated
-- identity security events can be anchored to a verification or webhook event.

DO $$
BEGIN
  ALTER TYPE "VerificationStatus" ADD VALUE 'AWAITING_LIVENESS';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SecurityEventType" ADD VALUE 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SecurityEventType" ADD VALUE 'WEBHOOK_SIGNATURE_INVALID_REPEATED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "SecurityEventType" ADD VALUE 'IDENTITY_VERIFICATION_PILOT_BREACH';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "provider_identity_verifications"
  ADD COLUMN IF NOT EXISTS "vendorReference" TEXT,
  ADD COLUMN IF NOT EXISTS "livenessSessionReference" TEXT,
  ADD COLUMN IF NOT EXISTS "livenessSessionUrlEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "livenessSessionExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "consentVendorKey" TEXT,
  ADD COLUMN IF NOT EXISTS "consentVendorDisplayName" TEXT,
  ADD COLUMN IF NOT EXISTS "consentTextHash" TEXT;

CREATE INDEX IF NOT EXISTS "provider_identity_verifications_sourceCheckProvider_vendorReference_idx"
  ON "provider_identity_verifications"("sourceCheckProvider", "vendorReference");
CREATE INDEX IF NOT EXISTS "provider_identity_verifications_sourceCheckProvider_livenessSessionReference_idx"
  ON "provider_identity_verifications"("sourceCheckProvider", "livenessSessionReference");

CREATE TABLE IF NOT EXISTS "provider_verification_webhook_events" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT,
  "vendorKey" TEXT NOT NULL,
  "vendorEventId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "vendorReference" TEXT,
  "livenessSessionReference" TEXT,
  "eventType" TEXT,
  "signatureValid" BOOLEAN NOT NULL,
  "payloadHash" TEXT,
  "rawPayloadRedacted" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "processingError" TEXT,
  CONSTRAINT "provider_verification_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_verification_webhook_events_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_verification_webhook_events_idempotencyKey_key"
  ON "provider_verification_webhook_events"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "provider_verification_webhook_events_verificationId_receivedAt_idx"
  ON "provider_verification_webhook_events"("verificationId", "receivedAt");
CREATE INDEX IF NOT EXISTS "provider_verification_webhook_events_vendorKey_vendorReference_idx"
  ON "provider_verification_webhook_events"("vendorKey", "vendorReference");
CREATE INDEX IF NOT EXISTS "provider_verification_webhook_events_vendorKey_livenessSessionReference_idx"
  ON "provider_verification_webhook_events"("vendorKey", "livenessSessionReference");
ALTER TABLE "public"."provider_verification_webhook_events" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "verification_vendor_configs" (
  "vendorKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  "livenessRequired" BOOLEAN NOT NULL DEFAULT true,
  "configJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "verification_vendor_configs_pkey" PRIMARY KEY ("vendorKey")
);
ALTER TABLE "public"."verification_vendor_configs" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "provider_identity_verification_pilot_allowlist" (
  "id" TEXT NOT NULL,
  "providerId" TEXT,
  "providerApplicationId" TEXT,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_identity_verification_pilot_allowlist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_identity_verification_pilot_allowlist_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_identity_verification_pilot_allowlist_providerApplicationId_fkey"
    FOREIGN KEY ("providerApplicationId") REFERENCES "provider_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pilot_allowlist_exactly_one_target_chk"
    CHECK (("providerId" IS NOT NULL) <> ("providerApplicationId" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "provider_identity_verification_pilot_allowlist_providerId_idx"
  ON "provider_identity_verification_pilot_allowlist"("providerId");
CREATE INDEX IF NOT EXISTS "provider_identity_verification_pilot_allowlist_providerApplicationId_idx"
  ON "provider_identity_verification_pilot_allowlist"("providerApplicationId");
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_allowlist_providerId_uniq"
  ON "provider_identity_verification_pilot_allowlist"("providerId")
  WHERE "providerId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "pilot_allowlist_providerApplicationId_uniq"
  ON "provider_identity_verification_pilot_allowlist"("providerApplicationId")
  WHERE "providerApplicationId" IS NOT NULL;
ALTER TABLE "public"."provider_identity_verification_pilot_allowlist" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "provider_identity_consent_events" (
  "id" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "vendorKey" TEXT NOT NULL,
  "vendorDisplayName" TEXT NOT NULL,
  "consentTextHash" TEXT NOT NULL,
  "consentTextVersion" TEXT NOT NULL,
  "channel" "VerificationChannel" NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedByProviderId" TEXT,
  "acceptedByApplicationId" TEXT,
  "metadata" JSONB,
  CONSTRAINT "provider_identity_consent_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_identity_consent_events_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "provider_identity_consent_events_verificationId_acceptedAt_idx"
  ON "provider_identity_consent_events"("verificationId", "acceptedAt");
CREATE INDEX IF NOT EXISTS "provider_identity_consent_events_consentTextHash_idx"
  ON "provider_identity_consent_events"("consentTextHash");
ALTER TABLE "public"."provider_identity_consent_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "security_events" ALTER COLUMN "phoneE164" DROP NOT NULL;
ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "subjectVerificationId" TEXT;
ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "subjectWebhookEventId" TEXT;

DO $$
BEGIN
  ALTER TABLE "security_events"
    ADD CONSTRAINT "security_events_subject_chk"
    CHECK ("phoneE164" IS NOT NULL OR "subjectVerificationId" IS NOT NULL OR "subjectWebhookEventId" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "security_events"
    ADD CONSTRAINT "security_events_subjectVerificationId_fkey"
    FOREIGN KEY ("subjectVerificationId") REFERENCES "provider_identity_verifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "security_events"
    ADD CONSTRAINT "security_events_subjectWebhookEventId_fkey"
    FOREIGN KEY ("subjectWebhookEventId") REFERENCES "provider_verification_webhook_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "security_events_subjectVerificationId_idx"
  ON "security_events"("subjectVerificationId");
CREATE INDEX IF NOT EXISTS "security_events_subjectWebhookEventId_idx"
  ON "security_events"("subjectWebhookEventId");
