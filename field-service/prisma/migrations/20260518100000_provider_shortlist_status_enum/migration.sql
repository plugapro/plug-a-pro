-- CreateEnum (includes all values used in codebase)
CREATE TYPE "ProviderShortlistStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED', 'PUBLISHED', 'SUPERSEDED');

-- Drop existing default so the type change is not blocked
ALTER TABLE "provider_shortlists"
  ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable: cast via text since direct enum-to-enum cast is not allowed in Postgres
ALTER TABLE "provider_shortlists"
  ALTER COLUMN "status" TYPE "ProviderShortlistStatus"
  USING "status"::text::"ProviderShortlistStatus";

-- Restore default using the new enum type
ALTER TABLE "provider_shortlists"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"ProviderShortlistStatus";
