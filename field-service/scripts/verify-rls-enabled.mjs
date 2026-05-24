import { PrismaClient } from '@prisma/client'

const query = `
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname <> '_prisma_migrations'
ORDER BY 1;
`

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to verify public-table RLS coverage.')
  process.exit(1)
}

const prisma = new PrismaClient()

try {
  const rows = await prisma.$queryRawUnsafe(query)
  const missingTables = rows.map((row) => row.relname)

  if (missingTables.length > 0) {
    console.error('Public tables without row level security:')
    for (const table of missingTables) {
      console.error(`- ${table}`)
    }
    process.exitCode = 1
  } else {
    console.log('All public tables have row level security enabled.')
  }
} catch (error) {
  console.error(`RLS verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
