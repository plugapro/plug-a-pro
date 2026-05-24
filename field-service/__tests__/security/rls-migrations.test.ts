import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma/migrations')
const RLS_BASELINE_MIGRATION = '20260421030000_enable_rls_all_tables'
const PRISMA_MIGRATIONS_TABLE = '_prisma_migrations'

type MigrationFile = {
  name: string
  sql: string
}

type TableEvent = {
  table: string
  migration: string
  migrationIndex: number
  offset: number
}

const QUOTED_IDENTIFIER = String.raw`"(?:""|[^"])+"`
const UNQUOTED_IDENTIFIER = String.raw`[A-Za-z_][A-Za-z0-9_$]*`
const IDENTIFIER = String.raw`(?:${QUOTED_IDENTIFIER}|${UNQUOTED_IDENTIFIER})`

const CREATE_PUBLIC_TABLE = new RegExp(
  String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"public"|public)\s*\.\s*)?(${IDENTIFIER})`,
  'gi',
)
const ENABLE_PUBLIC_RLS = new RegExp(
  String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:"public"|public)\s*\.\s*)?(${IDENTIFIER})\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;`,
  'gi',
)
const INTROSPECTIVE_RLS_SWEEP = /relrowsecurity\s*=\s*false[\s\S]*relname\s*<>\s*'_prisma_migrations'[\s\S]*ENABLE\s+ROW\s+LEVEL\s+SECURITY/i

function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sql: readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8'),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeIdentifier(identifier: string) {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.slice(1, -1).replace(/""/g, '"')
  }

  return identifier.toLowerCase()
}

function collectTableEvents(migrations: MigrationFile[], pattern: RegExp) {
  const events: TableEvent[] = []

  migrations.forEach((migration, migrationIndex) => {
    for (const match of migration.sql.matchAll(pattern)) {
      const identifier = match[1]
      if (!identifier) continue

      events.push({
        table: normalizeIdentifier(identifier),
        migration: migration.name,
        migrationIndex,
        offset: match.index ?? 0,
      })
    }
  })

  return events
}

function isLaterStatement(left: TableEvent, right: TableEvent) {
  return (
    left.migrationIndex > right.migrationIndex ||
    (left.migrationIndex === right.migrationIndex && left.offset > right.offset)
  )
}

function hasLaterIntrospectiveRlsSweep(migrations: MigrationFile[], created: TableEvent) {
  return migrations.some((migration, migrationIndex) => {
    if (migrationIndex < created.migrationIndex) return false
    if (migrationIndex === created.migrationIndex && !INTROSPECTIVE_RLS_SWEEP.test(migration.sql.slice(created.offset))) {
      return false
    }
    return migrationIndex > created.migrationIndex || INTROSPECTIVE_RLS_SWEEP.test(migration.sql.slice(created.offset))
  })
}

describe('RLS migration coverage', () => {
  it('enables RLS after every public table created after the RLS baseline', () => {
    const migrations = loadMigrations()
    const createdTables = collectTableEvents(migrations, CREATE_PUBLIC_TABLE)
    const enabledTables = collectTableEvents(migrations, ENABLE_PUBLIC_RLS)

    const missingRls = createdTables
      .filter((event) => event.migration > RLS_BASELINE_MIGRATION)
      .filter((event) => event.table !== PRISMA_MIGRATIONS_TABLE)
      // CREATE TABLE IF NOT EXISTS can create a fresh unprotected table in drifted databases,
      // so every post-baseline create statement needs a later RLS enable statement.
      .filter((created) => {
        const explicitEnable = enabledTables.some((enabled) => {
          return enabled.table === created.table && isLaterStatement(enabled, created)
        })
        return !(explicitEnable || hasLaterIntrospectiveRlsSweep(migrations, created))
      })
      .map((event) => `${event.table} (created in ${event.migration})`)

    expect(missingRls).toEqual([])
  })
})
