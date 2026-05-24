CREATE TABLE "provider_lead_access_tokens" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "jobRequestId" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "provider_lead_access_tokens_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."provider_lead_access_tokens" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "provider_lead_access_tokens_jti_key" ON "provider_lead_access_tokens"("jti");
CREATE UNIQUE INDEX "provider_lead_access_tokens_tokenHash_key" ON "provider_lead_access_tokens"("tokenHash");
CREATE INDEX "provider_lead_access_tokens_leadId_issuedAt_idx" ON "provider_lead_access_tokens"("leadId", "issuedAt");
CREATE INDEX "provider_lead_access_tokens_providerId_issuedAt_idx" ON "provider_lead_access_tokens"("providerId", "issuedAt");
CREATE INDEX "provider_lead_access_tokens_jobRequestId_idx" ON "provider_lead_access_tokens"("jobRequestId");
CREATE INDEX "provider_lead_access_tokens_expiresAt_idx" ON "provider_lead_access_tokens"("expiresAt");
CREATE INDEX "provider_lead_access_tokens_revokedAt_idx" ON "provider_lead_access_tokens"("revokedAt");

ALTER TABLE "provider_lead_access_tokens"
    ADD CONSTRAINT "provider_lead_access_tokens_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_lead_access_tokens"
    ADD CONSTRAINT "provider_lead_access_tokens_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_lead_access_tokens"
    ADD CONSTRAINT "provider_lead_access_tokens_jobRequestId_fkey"
    FOREIGN KEY ("jobRequestId") REFERENCES "job_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
