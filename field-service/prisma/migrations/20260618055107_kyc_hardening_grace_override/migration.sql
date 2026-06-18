-- KYC hardening: per-provider grace window + admin override audit trail.
--
-- Additive only. All columns are nullable so existing rows continue to satisfy
-- the schema with no backfill. Meaning is enforced in application code
-- (lib/provider-lead-eligibility.ts#checkCanBeApproved).
--
-- `kyc_required_from` — operational marker for when this provider entered the
-- mandatory-KYC regime; informational, not load-bearing today.
-- `kyc_grace_until` — per-provider grace deadline. While in the future and
-- the global enforcement flag is on, the provider may be approved/active
-- without VERIFIED. Populated by scripts/backfill-kyc-grace-windows.ts for
-- the legacy cohort.
-- `kyc_overridden_by/_at/_reason` — TRUST+ override audit. When set, the
-- provider may be approved without VERIFIED. Override creation is enforced
-- through crudAction() which separately writes the AuditLog + AdminAuditEvent
-- rows; these columns are the durable per-provider record.
ALTER TABLE "providers"
  ADD COLUMN "kycRequiredFrom"   TIMESTAMP(3),
  ADD COLUMN "kycGraceUntil"     TIMESTAMP(3),
  ADD COLUMN "kycOverriddenBy"   TEXT,
  ADD COLUMN "kycOverriddenAt"   TIMESTAMP(3),
  ADD COLUMN "kycOverrideReason" TEXT;

-- Index supports admin "grace expiring soon" reports + cron filters.
CREATE INDEX "providers_kycGraceUntil_idx" ON "providers"("kycGraceUntil");
