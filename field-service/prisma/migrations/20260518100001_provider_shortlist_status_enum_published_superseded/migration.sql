-- Add PUBLISHED and SUPERSEDED values to ProviderShortlistStatus enum
ALTER TYPE "ProviderShortlistStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED';
ALTER TYPE "ProviderShortlistStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';
