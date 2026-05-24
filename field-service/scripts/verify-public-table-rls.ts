import { db } from '../lib/db'

type PublicTableWithoutRls = {
  relname: string
}

export const PUBLIC_TABLES_WITHOUT_RLS_QUERY = `SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname <> '_prisma_migrations'
ORDER BY 1;`

export async function findPublicTablesWithoutRls() {
  return db.$queryRawUnsafe<PublicTableWithoutRls[]>(PUBLIC_TABLES_WITHOUT_RLS_QUERY)
}

export async function main() {
  const rows = await findPublicTablesWithoutRls()

  if (rows.length === 0) {
    console.log('OK: RLS is enabled on every public application table.')
    return
  }

  console.error(`RLS is disabled on ${rows.length} public application table(s):`)
  for (const row of rows) {
    console.error(`- ${row.relname}`)
  }
  process.exitCode = 1
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
    .finally(() => db.$disconnect())
}
