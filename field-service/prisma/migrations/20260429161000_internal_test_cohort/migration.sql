ALTER TABLE "customers"
  ADD COLUMN "isTestUser" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "providers"
  ADD COLUMN "isTestUser" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "provider_applications"
  ADD COLUMN "isTestUser" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "job_requests"
  ADD COLUMN "isTestRequest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "leads"
  ADD COLUMN "isTestLead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "lead_unlocks"
  ADD COLUMN "isTestUnlock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "jobs"
  ADD COLUMN "isTestJob" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "conversations"
  ADD COLUMN "isTestSession" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "message_events"
  ADD COLUMN "isTestEvent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "audit_logs"
  ADD COLUMN "isTestEvent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

ALTER TABLE "wallet_ledger_entries"
  ADD COLUMN "isTestTransaction" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cohortName" TEXT;

CREATE INDEX "providers_isTestUser_idx" ON "providers"("isTestUser");
CREATE INDEX "provider_applications_isTestUser_status_idx" ON "provider_applications"("isTestUser", "status");
CREATE INDEX "job_requests_isTestRequest_status_idx" ON "job_requests"("isTestRequest", "status");
CREATE INDEX "leads_isTestLead_status_idx" ON "leads"("isTestLead", "status");
CREATE INDEX "lead_unlocks_isTestUnlock_idx" ON "lead_unlocks"("isTestUnlock");
CREATE INDEX "wallet_ledger_entries_isTestTransaction_createdAt_idx" ON "wallet_ledger_entries"("isTestTransaction", "createdAt");

UPDATE "customers"
SET "isTestUser" = true, "cohortName" = 'internal_staff_test'
WHERE "phone" IN ('+27823035070', '+27773923802', '+27764010810', '+27832114183', '+27824978565', '+27827006695');

UPDATE "providers"
SET "isTestUser" = true, "cohortName" = 'internal_staff_test'
WHERE "phone" IN ('+27823035070', '+27773923802', '+27764010810', '+27832114183', '+27824978565', '+27827006695');

UPDATE "provider_applications"
SET "isTestUser" = true, "cohortName" = 'internal_staff_test'
WHERE "phone" IN ('+27823035070', '+27773923802', '+27764010810', '+27832114183', '+27824978565', '+27827006695');

UPDATE "conversations"
SET "isTestSession" = true, "cohortName" = 'internal_staff_test'
WHERE "phone" IN ('+27823035070', '+27773923802', '+27764010810', '+27832114183', '+27824978565', '+27827006695');
