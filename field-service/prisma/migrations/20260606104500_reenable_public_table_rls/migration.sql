-- Repair production RLS drift detected by field-service CI on 2026-06-06.
-- Earlier RLS migrations are recorded as applied; this idempotent sweep restores
-- the intended public-schema posture without changing application code paths.

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
