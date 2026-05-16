-- AddColumn: categories.regulated
-- Adds the regulated flag that was present in schema.prisma but missing from the
-- production categories table due to a DB restore that pre-dated this column.

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "regulated" BOOLEAN NOT NULL DEFAULT false;
