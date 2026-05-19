-- Repair migration: ws_b_crud_base / category_customer_lifecycle drift
--
-- These tables were created in prod with an older version of the migration
-- files. Subsequent edits to those migration files were never re-applied
-- because Prisma tracks applied migrations by name, not content.
--
-- All statements are idempotent (IF NOT EXISTS / DO $$ guards).
-- No data is dropped. Old columns (code, label, verifiedBy, tag, notes on
-- equipment) are left in place — they are unused by the current codebase but
-- removing them would require a separate, reviewed DROP.
--
-- Rollback: re-rename authorId -> adminId on the two notes tables; DROP the
-- newly added columns. This is a manual operation — no automated rollback.

-- ─── provider_notes ──────────────────────────────────────────────────────────
-- Rename adminId -> authorId (idempotent guard via DO block)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'provider_notes'
      AND column_name  = 'adminId'
  ) THEN
    ALTER TABLE "provider_notes" RENAME COLUMN "adminId" TO "authorId";
  END IF;
END $$;

ALTER TABLE "provider_notes"
  ADD COLUMN IF NOT EXISTS "pinned"      BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reasonCode"  TEXT,
  ADD COLUMN IF NOT EXISTS "strikeDelta" INTEGER  NOT NULL DEFAULT 0;

-- ─── customer_notes ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'customer_notes'
      AND column_name  = 'adminId'
  ) THEN
    ALTER TABLE "customer_notes" RENAME COLUMN "adminId" TO "authorId";
  END IF;
END $$;

ALTER TABLE "customer_notes"
  ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;

-- ─── provider_certifications ──────────────────────────────────────────────────
ALTER TABLE "provider_certifications"
  ADD COLUMN IF NOT EXISTS "issuingAuthority" TEXT,
  ADD COLUMN IF NOT EXISTS "certNumber"       TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedById"     TEXT,
  ADD COLUMN IF NOT EXISTS "notes"            TEXT;

-- ─── provider_equipment ───────────────────────────────────────────────────────
ALTER TABLE "provider_equipment"
  ADD COLUMN IF NOT EXISTS "serialNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "active"       BOOLEAN NOT NULL DEFAULT true;
