-- Catch-up: enable Row Level Security on post-baseline public tables.
-- The Ops Agent Workflow Team migration (20260620063639_ops_agent_workflow_team)
-- created six tables — ops_agent_runs, ops_recommendations, ops_draft_messages,
-- provider_profile_scores, request_friction_signals, ops_daily_briefings —
-- after the previous catch-up enabler (20260524170000) had already run, so they
-- shipped without RLS. This re-runs the same introspection-driven enabler.
--
-- Mirrors 20260524170000_enable_rls_remaining_public_tables: plain ENABLE
-- statements only. Prisma service-role access bypasses RLS; anon/authenticated
-- PostgREST access defaults to DENY ALL without application code changes. The
-- ops tables are written by the server-side runner and read by admin pages,
-- both on the service-role connection, so deny-by-default is the correct posture.

DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND c.relname <> '_prisma_migrations'
    ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      'public',
      table_record.relname
    );
  END LOOP;
END $$;
