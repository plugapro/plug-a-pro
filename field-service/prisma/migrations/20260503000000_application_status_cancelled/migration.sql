-- Add CANCELLED status to ApplicationStatus enum
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Add cancelledAt timestamp to provider_applications
ALTER TABLE "provider_applications" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
