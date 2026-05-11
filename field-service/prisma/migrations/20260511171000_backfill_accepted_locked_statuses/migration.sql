-- Normalize any selected-provider acceptances that reached the previous
-- legacy final state before Workflow 9 introduced explicit locked statuses.
UPDATE "leads" l
SET "status" = 'ACCEPTED_LOCKED'::"LeadStatus"
FROM "job_requests" jr
WHERE l."jobRequestId" = jr."id"
  AND l."id" = jr."selectedLeadInviteId"
  AND l."providerId" = jr."selectedProviderId"
  AND l."status" = 'ACCEPTED'::"LeadStatus"
  AND l."providerAcceptedAt" IS NOT NULL;

UPDATE "job_requests" jr
SET "status" = 'ACCEPTED_LOCKED'::"JobRequestStatus"
FROM "leads" l
WHERE l."id" = jr."selectedLeadInviteId"
  AND l."providerId" = jr."selectedProviderId"
  AND l."status" = 'ACCEPTED_LOCKED'::"LeadStatus"
  AND jr."status" = 'MATCHED'::"JobRequestStatus";
