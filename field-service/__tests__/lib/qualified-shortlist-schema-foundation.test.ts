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
    // Whitespace-tolerant: Prisma's auto-formatter realigns column widths
    // whenever the longest column name in a model changes (e.g. when a
    // sibling field is added). Assert shape, not spacing.
    expect(schema).toMatch(/\bselectedLeadInviteId\s+String\?\s+@unique/)
    expect(schema).toMatch(/\brequestRef\s+String\?\s+@unique/)

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

  it('repairs provider lead response enum drift back to text', () => {
    const repair = readFileSync(
      join(projectRoot, 'prisma/migrations/20260525105500_repair_provider_lead_response_text/migration.sql'),
      'utf8',
    )

    expect(repair).toContain('ALTER TABLE "provider_lead_responses"')
    expect(repair).toContain('ALTER COLUMN "response" TYPE TEXT')
    expect(repair).toContain('USING "response"::text')
  })
})
