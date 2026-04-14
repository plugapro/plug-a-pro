-- Backfill columns that were defined in the Prisma schema but never reached
-- production via an ALTER TABLE migration. The DB was built from early
-- incremental migrations; these fields were added to schema.prisma but the
-- corresponding DDL was never shipped as a recorded migration.

-- ── customers: WhatsApp preference fields ─────────────────────────────────────
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "whatsappServiceOptIn"      BOOLEAN   NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "whatsappMarketingOptIn"    BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "whatsappMarketingOptInAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappMarketingOptOutAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappMarketingSource"   TEXT,
  ADD COLUMN IF NOT EXISTS "lastWhatsappPrefSyncAt"    TIMESTAMP(3);

-- ── conversations: inactivity timeout deduplication ───────────────────────────
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "timeoutNotifiedAt" TIMESTAMP(3);

-- ── provider_applications: partial unique index (non-REJECTED phone) ──────────
-- Prevents duplicate pending/approved applications per phone number.
-- CONCURRENTLY cannot run inside a transaction; Supabase apply_migration wraps
-- in a transaction, so we use a regular CREATE UNIQUE INDEX here.
CREATE UNIQUE INDEX IF NOT EXISTS "provider_applications_phone_active_unique"
  ON "provider_applications" ("phone")
  WHERE "status" != 'REJECTED';
