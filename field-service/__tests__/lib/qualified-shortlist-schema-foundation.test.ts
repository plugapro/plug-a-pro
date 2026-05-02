import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

describe('qualified shortlist schema foundation', () => {
  it('adds provider response and shortlist models without destructive migration SQL', () => {
    const schema = readFileSync(join(projectRoot, 'prisma/schema.prisma'), 'utf8')
    const migration = readFileSync(
      join(projectRoot, 'prisma/migrations/20260502133500_qualified_shortlist_foundation/migration.sql'),
      'utf8',
    )

    expect(schema).toContain('model ProviderLeadResponse')
    expect(schema).toContain('model ProviderShortlist')
    expect(schema).toContain('model ProviderShortlistItem')
    expect(schema).toContain('selectedLeadInviteId String? @unique')
    expect(schema).toContain('requestRef  String?')

    expect(migration).toContain('CREATE TABLE "provider_lead_responses"')
    expect(migration).toContain('CREATE TABLE "provider_shortlists"')
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bTRUNCATE\b/i)
  })
})
