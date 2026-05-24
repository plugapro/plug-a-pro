-- ─── S-1 follow-up: Enable Row Level Security on post-baseline public tables ─
-- Mirrors 20260421030000_enable_rls_all_tables: plain ENABLE statements only.
-- Prisma service-role access bypasses RLS; anon/authenticated PostgREST access
-- defaults to DENY ALL without application code changes.

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
