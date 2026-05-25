import { existsSync, readFileSync } from 'node:fs'

loadLocalEnvFiles()
const { PrismaClient } = await import('@prisma/client')

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

function loadLocalEnvFiles() {
  const inheritedKeys = new Set(Object.keys(process.env))

  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue

    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/)
      if (!match || inheritedKeys.has(match[1])) continue

      process.env[match[1]] = unquoteEnvValue(match[2])
    }
  }
}

function unquoteEnvValue(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
