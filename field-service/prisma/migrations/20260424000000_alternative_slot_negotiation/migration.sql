-- Phase 5: Alternative-slot negotiation
-- Adds negotiation tracking fields to job_requests and slot storage on dispatch_decisions.

ALTER TABLE "job_requests"
  ADD COLUMN "altSlotNegotiationSentAt" TIMESTAMP(3),
  ADD COLUMN "altSlotNegotiationOutcome" TEXT;

ALTER TABLE "dispatch_decisions"
  ADD COLUMN "alternativeSlotOptions" JSONB;
