-- Catch-up: enable Row Level Security on workflow_events.
-- workflow_events was created in 20260621120000_workflow_events, which sorts
-- alphabetically AFTER 20260621120000_enable_rls_ops_agent_tables despite the
-- shared timestamp prefix, so the introspection-driven enabler ran before the
-- table existed and skipped it.
--
-- Mirrors 20260524170000_enable_rls_remaining_public_tables: plain ENABLE
-- statement only. Prisma service-role access bypasses RLS; anon/authenticated
-- PostgREST access defaults to DENY ALL without application code changes.
-- workflow_events is written by server-side event emitters and read by the
-- internal ops-agent runner — both on the service-role connection — so
-- deny-by-default is the correct posture.

ALTER TABLE "public"."workflow_events" ENABLE ROW LEVEL SECURITY;
