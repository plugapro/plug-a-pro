-- DropGhostColumns: remove columns that exist in production but not in schema.prisma
-- and have no code references. All confirmed unused before dropping.
--
-- customers.internalFlags      — CustomerInternalFlag[] array, enum still in schema
--                                but no field or code reference exists
-- provider_categories.addedAt  — timestamp, no Prisma field, no code reference
-- lead_unlocks.walletEntry     — text nullable, no Prisma field, no code reference

ALTER TABLE "customers" DROP COLUMN IF EXISTS "internalFlags";
ALTER TABLE "provider_categories" DROP COLUMN IF EXISTS "addedAt";
ALTER TABLE "lead_unlocks" DROP COLUMN IF EXISTS "walletEntry";
