// Read-only probe: which pending migrations' objects already exist in the DB?
// Used to decide between `prisma migrate deploy` (genuinely pending) and
// `prisma migrate resolve --applied` (applied out-of-band).
import { db } from '../lib/db'

type Probe = { migration: string; check: string; sql: string }

const probes: Probe[] = [
  { migration: '20260421030000_enable_rls_all_tables', check: 'customers RLS enabled', sql: `SELECT relrowsecurity::int AS hit FROM pg_class WHERE relname = 'customers' AND relnamespace = 'public'::regnamespace` },
  { migration: '20260421040000_add_missing_fk_indexes', check: 'idx_addresses_customerId exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM pg_indexes WHERE schemaname='public' AND indexname='idx_addresses_customerId'` },
  { migration: '20260429120000_provider_credit_wallet_ledger', check: 'provider_wallets table exists', sql: `SELECT (to_regclass('public.provider_wallets') IS NOT NULL)::int AS hit` },
  { migration: '20260429120000_provider_credit_wallet_ledger', check: 'wallet_ledger_entries table exists', sql: `SELECT (to_regclass('public.wallet_ledger_entries') IS NOT NULL)::int AS hit` },
  { migration: '20260429123000_provider_credit_payment_intents', check: 'payment_intents table exists', sql: `SELECT (to_regclass('public.payment_intents') IS NOT NULL)::int AS hit` },
  { migration: '20260429130000_paid_lead_unlocks', check: 'lead_unlocks table exists', sql: `SELECT (to_regclass('public.lead_unlocks') IS NOT NULL)::int AS hit` },
  { migration: '20260429133000_provider_promo_awards', check: 'provider_promo_awards table exists', sql: `SELECT (to_regclass('public.provider_promo_awards') IS NOT NULL)::int AS hit` },
  { migration: '20260429140000_lead_unlock_disputes', check: 'lead_unlock_disputes table exists', sql: `SELECT (to_regclass('public.lead_unlock_disputes') IS NOT NULL)::int AS hit` },
  { migration: '20260429143000_wallet_status_ledger_entries', check: 'WalletLedgerEntryType has suspended/reactivated values', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname = 'WalletLedgerEntryType' AND e.enumlabel IN ('WALLET_SUSPENDED', 'WALLET_REACTIVATED')` },
  { migration: '20260429150000_payfast_gateway_payment_intents', check: 'payment_intents.gateway column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_intents' AND column_name='gateway'` },
  { migration: '20260429161000_internal_test_cohort', check: 'customers.isTestUser column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='isTestUser'` },
  { migration: '20260430213000_wallet_ledger_status_and_adjustment_amounts', check: 'wallet_ledger_entries.amountCredits_valid_for_type constraint exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.table_constraints WHERE table_schema='public' AND table_name='wallet_ledger_entries' AND constraint_name='wallet_ledger_entries_amountCredits_valid_for_type' AND constraint_type='CHECK'` },
  { migration: '20260502133500_qualified_shortlist_foundation', check: 'provider_lead_responses table exists', sql: `SELECT (to_regclass('public.provider_lead_responses') IS NOT NULL)::int AS hit` },
  { migration: '20260502133500_qualified_shortlist_foundation', check: 'provider_shortlists table exists', sql: `SELECT (to_regclass('public.provider_shortlists') IS NOT NULL)::int AS hit` },
  { migration: '20260502140500_provider_onboarding_rate_capture', check: 'provider_applications.callOutFee column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_applications' AND column_name='callOutFee'` },
  { migration: '20260502143000_provider_application_more_info_and_category_approval', check: 'provider_applications.moreInfoRequest column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_applications' AND column_name LIKE '%moreInfo%'` },
  { migration: '20260502151000_customer_shortlist_statuses', check: 'leads.customerShortlistStatus column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name LIKE '%hortlist%'` },
  { migration: '20260502160000_address_access_notes', check: 'addresses.accessNotes column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='addresses' AND column_name LIKE '%ccess%'` },
  { migration: '20260502161500_lead_status_shortlist_extensions', check: 'leads enum has SHORTLISTED/etc', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='status'` },
  { migration: '20260502163000_attachment_safe_for_preview', check: 'attachments.safeForPreview column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='attachments' AND column_name='safeForPreview'` },
  { migration: '20260502170000_provider_application_email', check: 'provider_applications.email column exists', sql: `SELECT (COUNT(*) > 0)::int AS hit FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_applications' AND column_name='email'` },
]

async function main() {
  const seen = new Map<string, string[]>()
  for (const p of probes) {
    const rows = await db.$queryRawUnsafe<{ hit: number }[]>(p.sql).catch(() => [{ hit: -1 }])
    const hit = rows[0]?.hit
    const status = hit === 1 ? 'APPLIED  ' : hit === 0 ? 'PENDING  ' : 'ERR      '
    const arr = seen.get(p.migration) ?? []
    arr.push(`${status} ${p.check}`)
    seen.set(p.migration, arr)
  }

  // Also fetch _prisma_migrations history to cross-check
  const history = await db.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
    `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10`,
  ).catch(() => [])

  console.log('\n────────────────────────────────────────────────────────────────────────')
  console.log('Per-migration object presence in production DB:')
  console.log('────────────────────────────────────────────────────────────────────────')
  for (const [migration, checks] of seen) {
    console.log(`\n${migration}`)
    for (const c of checks) console.log(`  ${c}`)
  }

  console.log('\n────────────────────────────────────────────────────────────────────────')
  console.log('Most-recently recorded migrations in _prisma_migrations:')
  console.log('────────────────────────────────────────────────────────────────────────')
  for (const h of history) {
    console.log(`  ${h.finished_at ? 'OK ' : 'XX '} ${h.migration_name}`)
  }
}

main().catch(console.error).finally(() => db.$disconnect())
