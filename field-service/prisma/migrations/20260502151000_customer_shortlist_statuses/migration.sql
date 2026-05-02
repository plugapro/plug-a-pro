-- Add qualified-shortlist request states without changing existing request rows.
ALTER TYPE "JobRequestStatus" ADD VALUE IF NOT EXISTS 'SHORTLIST_READY';
ALTER TYPE "JobRequestStatus" ADD VALUE IF NOT EXISTS 'PROVIDER_CONFIRMATION_PENDING';
