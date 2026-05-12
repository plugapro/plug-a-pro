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

  it('includes an idempotent repair for interim shortlist column names', () => {
    const repair = readFileSync(
      join(projectRoot, 'prisma/migrations/20260512143000_repair_provider_shortlist_request_column/migration.sql'),
      'utf8',
    )

    expect(repair).toContain('RENAME COLUMN "jobRequestId" TO "requestId"')
    expect(repair).toContain('RENAME COLUMN "leadId" TO "leadInviteId"')
    expect(repair).toContain('RENAME COLUMN "status" TO "response"')
    expect(repair).toContain('RENAME COLUMN "score" TO "matchScore"')
    expect(repair).toContain('RENAME COLUMN "addedAt" TO "createdAt"')
    expect(repair).toContain('ADD COLUMN IF NOT EXISTS "publishedAt"')
    expect(repair).toContain('provider_shortlist_items_shortlistId_leadInviteId_key')
    expect(repair).toContain('provider_lead_responses_leadInviteId_createdAt_idx')
  })
})
