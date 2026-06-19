/**
 * seed-preview.ts
 *
 * Deterministic synthetic seed for a Supabase Branch DB (preview environment).
 * Creates the minimum cohort needed to canary-test feature flags, including
 * KYC nudge runs, without copying any production PII.
 *
 * Cohort produced (all phones are obviously-synthetic +27 600 ... numbers
 * outside the carrier range so they never accidentally route real WhatsApp
 * messages if the seed is ever run against the wrong DB):
 *
 * Providers (5):
 *   - prov-seed-verified         : VERIFIED, ACTIVE, legacy createdAt
 *   - prov-seed-not-started-1    : NOT_STARTED, legacy createdAt (KYC nudge target)
 *   - prov-seed-not-started-2    : NOT_STARTED, legacy createdAt (KYC nudge target)
 *   - prov-seed-rejected         : REJECTED, legacy createdAt (must NOT be nudged or grandfathered)
 *   - prov-seed-post-cutoff      : NOT_STARTED, post-cutoff createdAt (KYC-gate blocked)
 *
 * Customers (2):
 *   - cust-seed-1, cust-seed-2
 *
 * Feature flags: all relevant rollout flags inserted as enabled=false so the
 * seeded preview behaves like prod-default. Engineers flip on a per-branch
 * basis from the Supabase SQL editor.
 *
 * Optional canary provider: set PREVIEW_SEED_CANARY_PHONE to your real
 * WhatsApp number (E.164). One extra Provider row is created using that
 * number, in the KYC nudge cohort — so curl-the-cron actually sends YOU a
 * real WhatsApp.
 *
 * Safety: refuses to run against any DB whose hostname does NOT contain
 * "branch-" (the Supabase branch hostname pattern) UNLESS
 * ALLOW_SEED_AGAINST_NON_BRANCH=true is exported. This is the load-bearing
 * guard that keeps a misconfigured DATABASE_URL from seeding prod.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   SUPABASE_BRANCH=<your-pr-branch> npx tsx scripts/seed-preview.ts                # dry-run
 *   SUPABASE_BRANCH=<your-pr-branch> npx tsx scripts/seed-preview.ts --apply        # write
 *   PREVIEW_SEED_CANARY_PHONE='+27...' SUPABASE_BRANCH=<...> npx tsx scripts/seed-preview.ts --apply
 *
 * Requires:
 *   DATABASE_URL pointed at the branch DB (set by Supabase ↔ Vercel integration
 *     in preview env vars, or pulled from Supabase Management API by the operator).
 *   SUPABASE_BRANCH (info-only — printed for confirmation that you're targeting
 *     the right branch).
 */

import 'dotenv/config'
import { db } from '../lib/db'

const APPLY = process.argv.includes('--apply')
const ALLOW_NON_BRANCH = process.env.ALLOW_SEED_AGAINST_NON_BRANCH === 'true'
const CANARY_PHONE = process.env.PREVIEW_SEED_CANARY_PHONE?.trim()

// Pre-cutoff timestamps so the legacy-cohort grace flag treats these as
// grandfathered. Mirrors KYC_GRACE_CUTOFF in lib/matching/kyc-grace.ts.
const LEGACY_CREATED_AT = new Date('2026-05-01T00:00:00.000Z')
const POST_CUTOFF_CREATED_AT = new Date('2026-08-01T00:00:00.000Z')

type SeedProvider = {
  id: string
  phone: string
  name: string
  firstName: string
  kycStatus: 'VERIFIED' | 'NOT_STARTED' | 'REJECTED' | 'EXPIRED' | 'IN_PROGRESS' | 'SUBMITTED'
  createdAt: Date
  skills: string[]
  serviceAreas: string[]
  status: 'ACTIVE'
}

type SeedCustomer = {
  id: string
  phone: string
  name: string
}

// Phones in +27 60X range are reserved by ICASA but not currently issued to
// carriers as of 2026 — chosen so accidental sends bounce at Meta rather than
// reaching a real person.
const PROVIDERS: SeedProvider[] = [
  {
    id: 'prov-seed-verified',
    phone: '+27600000001',
    name: 'Seed Verified',
    firstName: 'Seed',
    kycStatus: 'VERIFIED',
    createdAt: LEGACY_CREATED_AT,
    skills: ['Plumbing', 'Handyman'],
    serviceAreas: ['Roodepoort'],
    status: 'ACTIVE',
  },
  {
    id: 'prov-seed-not-started-1',
    phone: '+27600000002',
    name: 'Seed NotStarted One',
    firstName: 'Seed',
    kycStatus: 'NOT_STARTED',
    createdAt: LEGACY_CREATED_AT,
    skills: ['Handyman'],
    serviceAreas: ['Krugersdorp'],
    status: 'ACTIVE',
  },
  {
    id: 'prov-seed-not-started-2',
    phone: '+27600000003',
    name: 'Seed NotStarted Two',
    firstName: 'Seed',
    kycStatus: 'NOT_STARTED',
    createdAt: LEGACY_CREATED_AT,
    skills: ['Cleaning'],
    serviceAreas: ['Roodepoort'],
    status: 'ACTIVE',
  },
  {
    id: 'prov-seed-rejected',
    phone: '+27600000004',
    name: 'Seed Rejected',
    firstName: 'Seed',
    kycStatus: 'REJECTED',
    createdAt: LEGACY_CREATED_AT,
    skills: ['Plumbing'],
    serviceAreas: ['Krugersdorp'],
    status: 'ACTIVE',
  },
  {
    id: 'prov-seed-post-cutoff',
    phone: '+27600000005',
    name: 'Seed PostCutoff',
    firstName: 'Seed',
    kycStatus: 'NOT_STARTED',
    createdAt: POST_CUTOFF_CREATED_AT,
    skills: ['Painting'],
    serviceAreas: ['Roodepoort'],
    status: 'ACTIVE',
  },
]

const CUSTOMERS: SeedCustomer[] = [
  { id: 'cust-seed-1', phone: '+27600100001', name: 'Seed Customer One' },
  { id: 'cust-seed-2', phone: '+27600100002', name: 'Seed Customer Two' },
]

// All feature flags relevant to the canary scenarios this seed supports. All
// start OFF — flip per-branch via SQL editor to test specific rollouts.
const FLAGS = [
  'kyc_drive.auto_nudge',
  'provider.kyc.required_for_activation',
  'provider.identity.verification',
  'provider.identity.verification.automation',
  'matching.verification_trust_tier',
  'admin.quality.uplift',
] as const

function assertBranchTarget() {
  const dbUrl = process.env.DATABASE_URL ?? ''
  const directUrl = process.env.DIRECT_URL ?? ''
  const probe = directUrl || dbUrl
  if (!probe) {
    throw new Error('Neither DATABASE_URL nor DIRECT_URL is set. Refusing to seed.')
  }

  let host = ''
  try {
    host = new URL(probe).hostname
  } catch {
    throw new Error('DATABASE_URL/DIRECT_URL is not a valid Postgres URL.')
  }

  // Branch pattern wins: if the hostname clearly identifies a Supabase
  // branch DB, allow it unconditionally. Branch hostnames carry a `branch-`,
  // `preview-`, `-preview-`, or `-pr-` token by the time Supabase's GitHub
  // integration finishes provisioning them.
  const looksLikeBranch =
    host.includes('branch-') ||
    host.startsWith('preview-') ||
    host.includes('-preview-') ||
    host.includes('-pr-')
  if (looksLikeBranch) return

  // Prod patterns are HARD-REFUSED even with the override. This catches both
  // the direct prod endpoint (db.<project-ref>.supabase.co) and any Supabase
  // pooler endpoint (which always points at a real project, never a branch).
  const looksLikeProdRoot =
    host === 'db.oghbryokdizklgwaqksp.supabase.co' ||
    host.endsWith('.pooler.supabase.com')
  if (looksLikeProdRoot) {
    throw new Error(
      `Refusing to seed: DB host "${host}" is a production endpoint, not a branch. ` +
        'This guard cannot be bypassed by ALLOW_SEED_AGAINST_NON_BRANCH.',
    )
  }

  // Unknown host — allow only if the operator explicitly overrode (for
  // local-Postgres development convenience).
  if (!ALLOW_NON_BRANCH) {
    throw new Error(
      `Refusing to seed: DB host "${host}" does not look like a Supabase branch hostname. ` +
        'Set ALLOW_SEED_AGAINST_NON_BRANCH=true to override — but only do this for a local Postgres ' +
        'you control.',
    )
  }
}

async function main() {
  console.log('─'.repeat(72))
  console.log('Preview branch seed')
  console.log(`  branch:    ${process.env.SUPABASE_BRANCH ?? '(SUPABASE_BRANCH not set — info only)'}`)
  console.log(`  mode:      ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`  canary:    ${CANARY_PHONE ? CANARY_PHONE.slice(0, 4) + '…' + CANARY_PHONE.slice(-3) : 'none'}`)
  console.log('─'.repeat(72))

  assertBranchTarget()

  const allProviders: SeedProvider[] = [...PROVIDERS]
  if (CANARY_PHONE) {
    allProviders.push({
      id: 'prov-seed-canary',
      phone: CANARY_PHONE,
      name: 'Seed Canary',
      firstName: 'Canary',
      kycStatus: 'NOT_STARTED',
      createdAt: LEGACY_CREATED_AT,
      skills: ['Handyman'],
      serviceAreas: ['Roodepoort'],
      status: 'ACTIVE',
    })
  }

  console.log(`\nProviders: ${allProviders.length}`)
  for (const p of allProviders) {
    console.log(`  ${APPLY ? '✓' : '·'} ${p.id} kyc=${p.kycStatus} created=${p.createdAt.toISOString().slice(0, 10)}`)
  }
  console.log(`\nCustomers: ${CUSTOMERS.length}`)
  for (const c of CUSTOMERS) {
    console.log(`  ${APPLY ? '✓' : '·'} ${c.id}`)
  }
  console.log(`\nFeature flags: ${FLAGS.length} (all enabled=false)`)
  for (const k of FLAGS) {
    console.log(`  ${APPLY ? '✓' : '·'} ${k}`)
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to write.')
    return
  }

  for (const p of allProviders) {
    await db.provider.upsert({
      where: { phone: p.phone },
      create: {
        id: p.id,
        phone: p.phone,
        name: p.name,
        firstName: p.firstName,
        kycStatus: p.kycStatus,
        createdAt: p.createdAt,
        skills: p.skills,
        serviceAreas: p.serviceAreas,
        status: p.status,
        active: true,
        verified: true,
        availableNow: true,
        isTestUser: true,
        cohortName: 'preview_seed',
      },
      update: {
        // Idempotency: leave verified/active/status as-is on re-run so manual
        // state changes engineers make in-branch survive a re-seed.
        kycStatus: p.kycStatus,
        skills: p.skills,
        serviceAreas: p.serviceAreas,
      },
    })
  }

  for (const c of CUSTOMERS) {
    await db.customer.upsert({
      where: { phone: c.phone },
      create: {
        id: c.id,
        phone: c.phone,
        name: c.name,
        active: true,
      },
      update: { name: c.name },
    })
  }

  for (const key of FLAGS) {
    await db.featureFlag.upsert({
      where: { key },
      create: { key, enabled: false, description: 'Seeded by scripts/seed-preview.ts' },
      update: {}, // never overwrite a flipped flag on re-seed
    })
  }

  console.log('\n✓ Seed applied.')
  console.log('\nNext steps:')
  console.log('  - Flip flags per-branch via Supabase SQL editor (branch DB):')
  console.log('      UPDATE feature_flags SET enabled = true WHERE key = \'kyc_drive.auto_nudge\';')
  console.log('  - Trigger a cron manually against the preview Vercel deployment.')
  console.log('  - See field-service/docs/preview-env.md §Operating procedure for the full flow.')
}

main()
  .catch((err) => {
    console.error('seed-preview failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
