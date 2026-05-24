DO $$
DECLARE
  public_table record;
BEGIN
  FOR public_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
      AND c.relname <> '_prisma_migrations'
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY;', public_table.relname);
  END LOOP;
END
$$;
