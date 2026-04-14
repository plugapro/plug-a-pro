-- Migration: provider_application_phone_dedup
-- Adds a partial unique index on provider_applications.phone for non-rejected applications.
--
-- Why partial (WHERE status != 'REJECTED'):
--   A rejected applicant must be able to re-apply. The index only prevents
--   duplicate PENDING or APPROVED applications for the same phone number.
--   This is safe to add even if the table already has rows — PostgreSQL evaluates
--   the WHERE predicate at index creation time and will error only if two non-REJECTED
--   rows share the same phone. Run the dedup query below first if needed.
--
-- Safety: CONCURRENTLY is used to avoid locking the table during index build.
-- NOTE: CONCURRENTLY cannot run inside a transaction, so this migration uses
-- a raw DDL statement outside the default transaction block.

-- Step 1 (manual, run once before migration if duplicates exist):
--   SELECT phone, count(*) FROM provider_applications
--   WHERE status != 'REJECTED'
--   GROUP BY phone HAVING count(*) > 1;
-- If the above returns rows, deduplicate by keeping the most-recent application
-- per phone and deleting older ones.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "provider_applications_phone_active_unique"
  ON "provider_applications" ("phone")
  WHERE "status" != 'REJECTED';
