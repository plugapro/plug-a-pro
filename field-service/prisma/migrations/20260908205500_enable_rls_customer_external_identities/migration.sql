-- Catch-up: enable Row Level Security on customer_external_identities.
-- Table created in 20260908205415_customer_external_identity (Task 11:
-- CustomerExternalIdentity model for marketplace host login, e.g. VodaPay).
--
-- Mirrors 20260621130000_enable_rls_workflow_events and
-- 20260524170000_enable_rls_remaining_public_tables: plain ENABLE statement
-- only. Prisma service-role access bypasses RLS; anon/authenticated
-- PostgREST access defaults to DENY ALL without application code changes.
-- customer_external_identities is written and read only by server-side
-- login/session code (lib/vodapay/identity.ts, Task 14) on the service-role
-- connection, and it stores an encrypted host access token, so deny-by-default
-- is the correct posture.

ALTER TABLE "public"."customer_external_identities" ENABLE ROW LEVEL SECURITY;
