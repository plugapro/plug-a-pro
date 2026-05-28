-- Didit hosted-flow identity verification adapter support.
-- Additive only: four nullable columns + one composite index on
-- ProviderIdentityVerification, plus a disabled vendor-config row so
-- the admin Vendors page can manage Didit without manual SQL.

ALTER TABLE "provider_identity_verifications"
  ADD COLUMN "vendorWorkflowId"  TEXT,
  ADD COLUMN "costEstimateCents" INTEGER,
  ADD COLUMN "costCurrency"      TEXT,
  ADD COLUMN "decisionAt"        TIMESTAMP(3);

CREATE INDEX "provider_identity_verifications_sourceCheckProvider_vendorWorkf_idx"
  ON "provider_identity_verifications"("sourceCheckProvider", "vendorWorkflowId");

-- Seed an inactive vendor-config row. Active flip happens through the admin
-- Vendors page once ops verifies the pilot allowlist + workflow ids.
INSERT INTO "verification_vendor_configs"
  ("vendorKey", "active", "confidenceThreshold", "livenessRequired", "configJson", "createdAt", "updatedAt")
VALUES
  ('didit', false, 0.85, true, '{"displayName":"Didit","hosted":true}'::jsonb, NOW(), NOW())
ON CONFLICT ("vendorKey") DO NOTHING;
