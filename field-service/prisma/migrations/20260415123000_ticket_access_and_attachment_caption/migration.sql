ALTER TABLE "job_requests"
  ADD COLUMN "customerAccessToken" TEXT,
  ADD COLUMN "customerAccessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "customerAccessTokenRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "job_requests_customerAccessToken_key"
  ON "job_requests"("customerAccessToken");

ALTER TABLE "attachments"
  ADD COLUMN "caption" TEXT;
