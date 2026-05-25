import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const publicTablesWithoutRlsQuery = `
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname <> '_prisma_migrations'
ORDER BY 1;
`

export async function verifyPublicTableRls({
  PrismaClientClass,
  env = process.env,
} = {}) {
  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL is required to verify public-table RLS coverage.')
    process.exitCode = 1
    return
  }

  const { PrismaClient } = PrismaClientClass
    ? { PrismaClient: PrismaClientClass }
    : await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const rows = await prisma.$queryRawUnsafe(publicTablesWithoutRlsQuery)
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
}

export function loadLocalEnvFiles({
  cwd = process.cwd(),
  env = process.env,
  files = ['.env', '.env.local'],
  exists = existsSync,
  readFile = (file) => readFileSync(file, 'utf8'),
} = {}) {
  const inheritedKeys = new Set(Object.keys(env))

  for (const file of files) {
    const filePath = path.resolve(cwd, file)
    if (!exists(filePath)) continue

    for (const line of readFile(filePath).split(/\r?\n/)) {
      const parsed = parseEnvLine(line)
      if (!parsed || inheritedKeys.has(parsed.key)) continue

      env[parsed.key] = parsed.value
    }
  }
}

export function parseEnvLine(line) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/)
  if (!match) return null

  return {
    key: match[1],
    value: unquoteEnvValue(match[2]),
  }
}

export function unquoteEnvValue(value) {
  const trimmed = stripInlineComment(value).trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stripInlineComment(value) {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (
      char === '#' &&
      !inSingleQuote &&
      !inDoubleQuote &&
      (i === 0 || /\s/.test(value[i - 1]))
    ) {
      return value.slice(0, i)
    }
  }

  return value
}

function isMainModule() {
  const entrypoint = process.argv[1]
  if (!entrypoint) return false
  return path.resolve(entrypoint) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  loadLocalEnvFiles()
  await verifyPublicTableRls()
}
