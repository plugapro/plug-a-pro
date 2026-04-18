-- Backfill provider columns that exist in the Prisma schema but were never
-- included in a migration and therefore missing from production.

ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "experience"     TEXT,
  ADD COLUMN IF NOT EXISTS "evidenceNote"   TEXT,
  ADD COLUMN IF NOT EXISTS "portfolioUrls"  TEXT[] NOT NULL DEFAULT '{}';
