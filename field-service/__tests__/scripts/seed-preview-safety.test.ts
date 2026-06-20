// The seed-preview script has ONE load-bearing safety property: refuse to run
// against any host that isn't a Supabase branch (or a local DB if the
// ALLOW_SEED_AGAINST_NON_BRANCH override is set). The guard is what prevents
// a misconfigured DATABASE_URL from seeding the production project. These
// tests pin the guard logic in isolation — the rest of the seed (upsert calls
// against the live DB) is exercised by running it against a real branch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Module-level mock for the prisma client — seed-preview imports `db` at the
// top level, so vi.mock must hoist above the import.
vi.mock('@/lib/db', () => ({
  db: {
    provider: { upsert: vi.fn() },
    customer: { upsert: vi.fn() },
    featureFlag: { upsert: vi.fn() },
    $disconnect: vi.fn(),
  },
}))

// Recreate the assertBranchTarget logic in isolation. We can't import it
// directly because seed-preview.ts runs `main()` at module load. This is a
// duplicated copy of the guard from the script — keep them in sync.
function assertBranchTarget(opts: { allowNonBranch: boolean }) {
  const dbUrl = process.env.DATABASE_URL ?? ''
  const directUrl = process.env.DIRECT_URL ?? ''
  const probe = directUrl || dbUrl
  if (!probe) throw new Error('Neither DATABASE_URL nor DIRECT_URL is set. Refusing to seed.')

  let host = ''
  try {
    host = new URL(probe).hostname
  } catch {
    throw new Error('DATABASE_URL/DIRECT_URL is not a valid Postgres URL.')
  }

  const looksLikeBranch =
    host.includes('branch-') ||
    host.startsWith('preview-') ||
    host.includes('-preview-') ||
    host.includes('-pr-')
  if (looksLikeBranch) return

  const looksLikeProdRoot =
    host === 'db.oghbryokdizklgwaqksp.supabase.co' ||
    host.endsWith('.pooler.supabase.com')
  if (looksLikeProdRoot) {
    throw new Error(
      `Refusing to seed: DB host "${host}" is a production endpoint, not a branch.`,
    )
  }

  if (!opts.allowNonBranch) {
    throw new Error(
      `Refusing to seed: DB host "${host}" does not look like a Supabase branch hostname.`,
    )
  }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.DATABASE_URL
  delete process.env.DIRECT_URL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('seed-preview safety guard', () => {
  it('refuses when neither DATABASE_URL nor DIRECT_URL is set', () => {
    expect(() => assertBranchTarget({ allowNonBranch: false })).toThrow(/Neither DATABASE_URL/)
  })

  it('refuses against the prod project root', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db.oghbryokdizklgwaqksp.supabase.co:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).toThrow(/production endpoint/)
  })

  it('refuses against the prod project root EVEN WHEN allowNonBranch is true', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db.oghbryokdizklgwaqksp.supabase.co:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: true })).toThrow(/production endpoint/)
  })

  it('refuses against the prod pooler', () => {
    process.env.DATABASE_URL =
      'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).toThrow(
      /production endpoint/,
    )
  })

  it('refuses against the prod pooler EVEN WHEN allowNonBranch is true', () => {
    process.env.DATABASE_URL =
      'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: true })).toThrow(
      /production endpoint/,
    )
  })

  it('refuses an arbitrary remote host without the override', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@some-other-host.example.com:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).toThrow(
      /does not look like a Supabase branch hostname/,
    )
  })

  it('allows a local Postgres when ALLOW_SEED_AGAINST_NON_BRANCH is set', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: true })).not.toThrow()
  })

  it('refuses a local Postgres without the override', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).toThrow(
      /does not look like a Supabase branch hostname/,
    )
  })

  it('accepts a Supabase branch hostname', () => {
    process.env.DATABASE_URL =
      'postgresql://u:p@branch-feat-foo.oghbryokdizklgwaqksp.supabase.co:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).not.toThrow()
  })

  it('accepts a branch hostname even without the override', () => {
    process.env.DATABASE_URL =
      'postgresql://u:p@preview-pr-114.oghbryokdizklgwaqksp.supabase.co:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).not.toThrow()
  })

  it('refuses a malformed Postgres URL', () => {
    process.env.DATABASE_URL = 'not-a-url'
    expect(() => assertBranchTarget({ allowNonBranch: true })).toThrow(/not a valid Postgres URL/)
  })

  it('prefers DIRECT_URL over DATABASE_URL for the safety check', () => {
    // DATABASE_URL looks like a branch, DIRECT_URL points at prod — refuse.
    process.env.DATABASE_URL =
      'postgresql://u:p@branch-foo.oghbryokdizklgwaqksp.supabase.co:5432/postgres'
    process.env.DIRECT_URL = 'postgresql://u:p@db.oghbryokdizklgwaqksp.supabase.co:5432/postgres'
    expect(() => assertBranchTarget({ allowNonBranch: false })).toThrow(/production endpoint/)
  })
})
