import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(__dirname, '../../prisma/migrations')

function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((name) => existsSync(path.join(migrationsDir, name, 'migration.sql')))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'),
    }))
}

function publicTablesCreatedBy(sql: string): string[] {
  const tables = new Set<string>()
  const createTablePattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"public"|public)\.)?"([^"]+)"/gi

  for (const match of sql.matchAll(createTablePattern)) {
    const table = match[1]
    if (table !== '_prisma_migrations') {
      tables.add(table)
    }
  }

  return [...tables]
}

function publicTablesEnabledBy(sql: string): string[] {
  const tables = new Set<string>()
  const enablePattern =
    /ALTER\s+TABLE\s+"public"\."([^"]+)"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi

  for (const match of sql.matchAll(enablePattern)) {
    const table = match[1]
    if (table !== '_prisma_migrations') {
      tables.add(table)
    }
  }

  return [...tables]
}

function hasDynamicPublicRlsEnabler(sql: string): boolean {
  return /pg_class\s+c/i.test(sql) &&
    /relrowsecurity\s*=\s*false/i.test(sql) &&
    /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql) &&
    !/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql)
}

describe('RLS migration coverage', () => {
  it('enables RLS for OTP fraud response security tables in their migration', () => {
    const migration = migrationFiles().find(
      (file) => file.name === '20260526090000_otp_fraud_response_security',
    )

    expect(migration?.sql).toBeTruthy()
    expect(publicTablesEnabledBy(migration!.sql).sort()).toEqual([
      'account_security_states',
      'otp_challenges',
      'security_events',
    ])
  })

  it('enables row level security in a later migration for every public table', () => {
    const files = migrationFiles()
    const missing: string[] = []

    files.forEach((file, index) => {
      for (const table of publicTablesCreatedBy(file.sql)) {
        const currentOrLaterMigrationEnablesRls = files
          .slice(index)
          .some((laterFile) => (
            hasDynamicPublicRlsEnabler(laterFile.sql) ||
            publicTablesEnabledBy(laterFile.sql).includes(table)
          ))

        if (!currentOrLaterMigrationEnablesRls) {
          missing.push(`${table} created in ${file.name}`)
        }
      }
    })

    expect(missing).toEqual([])
  })

  it('keeps the latest catch-up migration introspection-driven and deny-by-default', () => {
    const catchUp = migrationFiles().find((file) => file.name === '20260524170000_enable_rls_remaining_public_tables')

    expect(catchUp?.sql).toBeTruthy()
    expect(hasDynamicPublicRlsEnabler(catchUp!.sql)).toBe(true)
    expect(catchUp!.sql).not.toMatch(/CREATE\s+POLICY/i)
    expect(catchUp!.sql).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i)
  })
})
