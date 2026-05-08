-- Promote the existing non-unique index on provider_shortlists(requestId, status)
-- to a unique constraint. This closes the TOCTOU race in shortlistProviderForCustomerReview
-- where concurrent calls could create duplicate DRAFT shortlists for the same request.
-- Additive migration: replaces an index with a unique index on the same columns.

DROP INDEX IF EXISTS "provider_shortlists_requestId_status_idx";
CREATE UNIQUE INDEX "provider_shortlists_requestId_status_key" ON "provider_shortlists"("requestId", "status");
