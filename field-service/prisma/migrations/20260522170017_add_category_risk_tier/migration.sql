-- CreateEnum
CREATE TYPE "CategoryRiskTier" AS ENUM ('LOW', 'STANDARD');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "riskTier" "CategoryRiskTier" NOT NULL DEFAULT 'STANDARD';
