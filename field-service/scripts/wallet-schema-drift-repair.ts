// ─── Controlled wallet schema drift repair utility ─────────────────────────────
// This utility captures a pre-change snapshot, preserves legacy wallet tables,
// rebuilds wallet schema objects in a single repair transaction, restores rows,
// and optionally aligns migration history markers.
//
// Backup tables are created with LIKE ... INCLUDING ALL, which copies column
// definitions, indexes, and check constraints but does NOT copy foreign key
// constraints. The backups are for data recovery only — do not use them as
// live replacements for the canonical tables.
//
// The script intentionally avoids touching lead/payment tables beyond schema
// presence checks. Wallet identifiers are preserved to keep legacy ledger
// references valid where possible.

import { execSync } from 'node:child_process'
import {
  Prisma,
  type WalletLedgerEntryType,
  type WalletCreditType,
} from '@prisma/client'
import { db } from '../lib/db'

type LegacyRow = Record<string, unknown>

const WALLETS = 'provider_wallets'
const LEDGER = 'wallet_ledger_entries'

const WALLET_MIGRATIONS = [
  '20260429120000_provider_credit_wallet_ledger',
  '20260429123000_provider_credit_payment_intents',
  '20260429130000_paid_lead_unlocks',
  '20260429133000_provider_promo_awards',
  '20260429143000_wallet_status_ledger_entries',
  '20260429161000_internal_test_cohort',
  '20260430213000_wallet_ledger_status_and_adjustment_amounts',
] as const

const WALLET_DEPENDENCY_TABLES = ['payment_intents', 'lead_unlocks', 'provider_promo_awards'] as const

const LEGACY_BACKUP_SUFFIX = '__legacy'
const PROVIDER_WALLET_BACKUP = `${WALLETS}${LEGACY_BACKUP_SUFFIX}`
const LEDGER_BACKUP = `${LEDGER}${LEGACY_BACKUP_SUFFIX}`

const args = new Set(process.argv.slice(2))
const isApply = args.has('--apply')
const resolveMigrations = args.has('--resolve-migrations')
const force = args.has('--force')

const PRISMA_COMMAND = args.has('--prisma-cmd-pnpm')
  ? { command: 'pnpm', args: ['exec', 'prisma'] }
  : { command: 'npx', args: ['prisma'] }

const ENTRY_TYPES = [
  'TOPUP_CREDIT',
  'PROMO_CREDIT',
  'LEAD_UNLOCK_DEBIT',
  'LEAD_REFUND_CREDIT',
  'ADMIN_ADJUSTMENT',
  'WALLET_SUSPENDED',
  'WALLET_REACTIVATED',
  'PROMO_EXPIRY',
  'PAYMENT_REVERSAL',
] as const

const CREDIT_TYPES = ['PAID', 'PROMO'] as const
const WALLET_STATUS_VALUES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const
const PAYMENT_INTENT_METHOD_VALUES = [
  'MANUAL_EFT',
  'PAYMENT_LINK',
  'GATEWAY_CARD',
  'GATEWAY_EFT',
] as const
const PAYMENT_INTENT_STATUS_VALUES = [
  'CREATED',
  'PENDING_PAYMENT',
  'PROOF_UPLOADED',
  'MATCHED_ON_STATEMENT',
  'CREDITED',
  'FAILED',
  'EXPIRED',
  'REVERSED',
] as const
const LEAD_UNLOCK_STATUS_VALUES = ['UNLOCKED', 'REFUNDED', 'DISPUTED', 'REVERSED'] as const
const PROMO_AWARD_TYPE_VALUES = [
  'MOBILE_VERIFIED',
  'PROFILE_COMPLETED',
  'KYC_APPROVED',
  'FIRST_TOPUP',
  'FIRST_COMPLETED_JOB',
] as const
const PROMO_AWARD_STATUS_VALUES = ['AWARDED', 'REVOKED'] as const

type MigrationRow = {
  migration_name: string
  finished_at: Date | null
  applied_steps_count: number
}

type MigrationState = 'MISSING' | 'APPLIED' | 'ZERO_STEPS' | 'INCOMPLETE'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  return 0
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    if (value.trim().length === 0) return false
    return ['true', '1', 't', 'yes', 'y'].includes(value.toLowerCase())
  }
  return false
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim()
  return null
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

function asJson(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as Prisma.JsonObject
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Prisma.JsonObject
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeWalletStatus(raw: unknown): (typeof WALLET_STATUS_VALUES)[number] {
  const value = asString(raw)?.toUpperCase()
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'CLOSED') return value
  return 'ACTIVE'
}

function normalizeEntryType(raw: unknown): WalletLedgerEntryType {
  const value = asString(raw)?.toUpperCase()
  if (value && ENTRY_TYPES.includes(value as never)) return value as WalletLedgerEntryType
  if (value === 'SUSPENDED') return 'WALLET_SUSPENDED'
  if (value === 'REACTIVATED') return 'WALLET_REACTIVATED'
  return 'TOPUP_CREDIT'
}

function normalizeCreditType(raw: unknown, fallback: WalletLedgerEntryType): WalletCreditType {
  const value = asString(raw)?.toUpperCase()
  if (value === 'PROMO') return 'PROMO'
  if (value === 'PAID') return 'PAID'
  if (fallback === 'PROMO_CREDIT' || fallback === 'PROMO_EXPIRY') return 'PROMO'
  return 'PAID'
}

function normalizeMetadata(rawMetadata: unknown): Prisma.JsonObject {
  const metadata = asJson(rawMetadata)
  return {
    ...metadata,
    source: 'wallet-schema-drift-repair',
  }
}

function migrationState(row: MigrationRow | undefined): MigrationState {
  if (!row) return 'MISSING'
  if (row.finished_at && row.applied_steps_count > 0) return 'APPLIED'
  if (!row.finished_at && row.applied_steps_count === 0) return 'ZERO_STEPS'
  return 'INCOMPLETE'
}

function ledgerDelta(entryType: WalletLedgerEntryType, amountCredits: number): number {
  switch (entryType) {
    case 'TOPUP_CREDIT':
    case 'PROMO_CREDIT':
    case 'LEAD_REFUND_CREDIT':
      return amountCredits
    case 'LEAD_UNLOCK_DEBIT':
    case 'PROMO_EXPIRY':
    case 'PAYMENT_REVERSAL':
      return -amountCredits
    case 'ADMIN_ADJUSTMENT':
      return amountCredits
    default:
      return 0
  }
}

const ALLOWED_TABLE_NAME = /^[A-Za-z0-9_]+$/

function assertSafeTableName(name: string): void {
  if (!ALLOWED_TABLE_NAME.test(name)) throw new Error(`Unsafe table name: ${name}`)
}

async function tableExists(tableName: string): Promise<boolean> {
  assertSafeTableName(tableName)
  const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '${tableName}'
     ) as exists`,
  )
  return Boolean(rows[0]?.exists)
}

// Small defensive helper used during dry-run snapshots where target tables may be absent.
async function safeTableCount(tableName: string): Promise<number> {
  try {
    assertSafeTableName(tableName)
    if (!(await tableExists(tableName))) return 0
    const rows = await db.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM "${tableName}"`)
    return rows[0]?.count ?? 0
  } catch {
    return 0
  }
}

async function readLegacyColumns(tableName: string): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName}'`,
  )
  return new Set(rows.map((row) => row.column_name))
}

async function fetchMigrationRows(): Promise<Map<string, MigrationRow>> {
  const rows = await db.$queryRawUnsafe<MigrationRow[]>(
    `SELECT migration_name, finished_at, applied_steps_count
       FROM "_prisma_migrations"
      ORDER BY migration_name`,
  )
  const map = new Map<string, MigrationRow>()
  for (const row of rows) map.set(row.migration_name, row)
  return map
}

function requiredEnum(name: string, values: readonly string[]): string {
  const valueList = values.map((value) => `'${value}'`).join(', ')
  return `CREATE TYPE "${name}" AS ENUM (${valueList})`
}

function ensureEnumTypeSql(typeName: string, values: readonly string[]): string[] {
  const result: string[] = [
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = '${typeName}'
  ) THEN
    ${requiredEnum(typeName, values)};
  END IF;
END $$;`,
  ]
  for (const value of values) {
    result.push(`DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    INNER JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = '${typeName}'
      AND e.enumlabel = '${value}'
  ) THEN
    ALTER TYPE "${typeName}" ADD VALUE '${value}';
  END IF;
END $$;`)
  }
  return result
}

function normalizeLegacyWalletRows(rows: LegacyRow[]): Prisma.ProviderWalletCreateManyInput[] {
  return rows.flatMap((row) => {
    const providerId = asString(row.providerId)
    if (!providerId) return []

    const paidBalanceRaw =
      (typeof row.paidCreditBalance === 'number' ? row.paidCreditBalance : toNumber(row.paidCreditBalance))
      || toNumber(row.balanceCents)
      || 0
    const promoBalanceRaw =
      (typeof row.promoCreditBalance === 'number' ? row.promoCreditBalance : toNumber(row.promoCreditBalance))
      || toNumber(row.starterCreditBalance)
      || 0

    return [{
      id: asString(row.id) ?? `${providerId}-${Date.now()}`,
      providerId,
      paidCreditBalance: Math.max(0, Math.floor(paidBalanceRaw)),
      promoCreditBalance: Math.max(0, Math.floor(promoBalanceRaw)),
      status: normalizeWalletStatus(row.status),
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
    }]
  })
}

function normalizeLegacyLedgerRows(
  rows: LegacyRow[],
  walletByProviderId: Map<string, string>,
): Prisma.WalletLedgerEntryCreateManyInput[] {
  const balancesByProvider = new Map<string, { paidCreditBalance: number; promoCreditBalance: number }>()
  const out: Prisma.WalletLedgerEntryCreateManyInput[] = []
  for (const row of rows) {
    const providerId = asString(row.providerId)
    if (!providerId) continue

    const walletId = asString(row.walletId) ?? walletByProviderId.get(providerId)
    if (!walletId) continue

    const entryType = normalizeEntryType(row.entryType ?? row.transactionType)
    const creditType = normalizeCreditType(
      row.creditType,
      entryType,
    )
    const amount = Math.abs(toNumber(row.amountCredits ?? row.amount ?? row.credits))
    const amountCredits = Math.floor(amount)

    const metadata = normalizeMetadata(row.metadata)
    const createdAt = asDate(row.createdAt)
    const safeProviderState = balancesByProvider.get(providerId) ?? { paidCreditBalance: 0, promoCreditBalance: 0 }

    const explicitPaid = row.balanceAfterPaidCredits ?? row.balanceAfterPaid
    const explicitPromo = row.balanceAfterPromoCredits ?? row.balanceAfterPromo
    const hasExplicitAfter = explicitPaid !== undefined && explicitPromo !== undefined

    const currentPaid =
      hasExplicitAfter ? toNumber(explicitPaid) : safeProviderState.paidCreditBalance + (creditType === 'PAID' ? ledgerDelta(entryType, amountCredits) : 0)
    const currentPromo =
      hasExplicitAfter ? toNumber(explicitPromo) : safeProviderState.promoCreditBalance + (creditType === 'PROMO' ? ledgerDelta(entryType, amountCredits) : 0)

    const balanceAfterPaidCredits = Math.max(0, Math.floor(currentPaid))
    const balanceAfterPromoCredits = Math.max(0, Math.floor(currentPromo))

    const nextState = {
      paidCreditBalance: creditType === 'PAID'
        ? currentPaid
        : safeProviderState.paidCreditBalance,
      promoCreditBalance: creditType === 'PROMO'
        ? currentPromo
        : safeProviderState.promoCreditBalance,
    }
    balancesByProvider.set(providerId, nextState)

    out.push({
      id: asString(row.id) ?? `${walletId}-${providerId}-${createdAt.getTime()}`,
      walletId,
      providerId,
      entryType,
      creditType,
      amountCredits,
      isTestTransaction: toBoolean(row.isTestTransaction ?? row.is_test_transaction),
      cohortName: asString(row.cohortName) ?? asString(row.cohort_name),
      balanceAfterPaidCredits,
      balanceAfterPromoCredits,
      referenceType: asString(row.referenceType) ?? asString(row.reference_type) ?? 'wallet_ledger_repair',
      referenceId: asString(row.referenceId) ?? asString(row.reference_id) ?? asString(row.id) ?? 'legacy-repair',
      description: asString(row.description),
      metadata,
      createdAt,
      createdBy: asString(row.createdBy) ?? asString(row.created_by),
    })
  }
  return out
}

async function runCommand(command: string, args: string[]) {
  if (!isApply) return
  if (!resolveMigrations && command === 'resolve') return
  const commandString = `${command} ${args.map((arg) => `${arg}`).join(' ')}`
  const env = {
    ...process.env,
    ...(process.env.DATABASE_URL ? {
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DATABASE_URL,
    } : {}),
  }
  const result = execSync(commandString, {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  })
  if (result !== undefined) void result
}

async function printMigrationStatus(migrations: Map<string, MigrationRow>) {
  console.log('\nWallet migration status from _prisma_migrations:')
  for (const migration of WALLET_MIGRATIONS) {
    const state = migrationState(migrations.get(migration))
    const label = state.padEnd(10)
    console.log(`  ${label} ${migration}`)
  }
}

async function ensureWalletEnums(tx: any) {
  for (const sql of [
    ...ensureEnumTypeSql('ProviderWalletStatus', WALLET_STATUS_VALUES),
    ...ensureEnumTypeSql('WalletLedgerEntryType', ENTRY_TYPES),
    ...ensureEnumTypeSql('WalletCreditType', CREDIT_TYPES),
    ...ensureEnumTypeSql('PaymentIntentMethod', PAYMENT_INTENT_METHOD_VALUES),
    ...ensureEnumTypeSql('PaymentIntentStatus', PAYMENT_INTENT_STATUS_VALUES),
    ...ensureEnumTypeSql('LeadUnlockStatus', LEAD_UNLOCK_STATUS_VALUES),
    ...ensureEnumTypeSql('ProviderPromoAwardType', PROMO_AWARD_TYPE_VALUES),
    ...ensureEnumTypeSql('ProviderPromoAwardStatus', PROMO_AWARD_STATUS_VALUES),
  ]) {
    await tx.$executeRawUnsafe(sql)
  }
}

async function ensureCanonicalWalletSchema(tx: any) {
  await ensureWalletEnums(tx)

  // Rebuild wallet tables in a canonical form that matches the migration contracts.
  await tx.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "provider_wallets" (
      "id" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "paidCreditBalance" INTEGER NOT NULL DEFAULT 0,
      "promoCreditBalance" INTEGER NOT NULL DEFAULT 0,
      "status" "ProviderWalletStatus" NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "provider_wallets_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "provider_wallets_paidCreditBalance_nonnegative" CHECK ("paidCreditBalance" >= 0),
      CONSTRAINT "provider_wallets_promoCreditBalance_nonnegative" CHECK ("promoCreditBalance" >= 0),
      CONSTRAINT "provider_wallets_providerId_providerId_key" UNIQUE ("providerId"),
      CONSTRAINT "provider_wallets_providerId_fkey" FOREIGN KEY ("providerId")
        REFERENCES "providers"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
    )
  `)
  await tx.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "provider_wallets_providerId_key"
      ON "provider_wallets"("providerId")
  `)

  await tx.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
      "id" TEXT NOT NULL,
      "walletId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "entryType" "WalletLedgerEntryType" NOT NULL,
      "creditType" "WalletCreditType" NOT NULL,
      "amountCredits" INTEGER NOT NULL,
      "balanceAfterPaidCredits" INTEGER NOT NULL,
      "balanceAfterPromoCredits" INTEGER NOT NULL,
      "referenceType" TEXT NOT NULL,
      "referenceId" TEXT NOT NULL,
      "description" TEXT,
      "metadata" JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdBy" TEXT,
      "isTestTransaction" BOOLEAN NOT NULL DEFAULT false,
      "cohortName" TEXT,
      CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "wallet_ledger_entries_amountCredits_positive" CHECK ("amountCredits" > 0),
      CONSTRAINT "wallet_ledger_entries_balanceAfterPaidCredits_nonnegative" CHECK ("balanceAfterPaidCredits" >= 0),
      CONSTRAINT "wallet_ledger_entries_balanceAfterPromoCredits_nonnegative" CHECK ("balanceAfterPromoCredits" >= 0),
      CONSTRAINT "wallet_ledger_entries_walletId_fkey" FOREIGN KEY ("walletId")
        REFERENCES "provider_wallets"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT "wallet_ledger_entries_providerId_fkey" FOREIGN KEY ("providerId")
        REFERENCES "providers"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
    )
  `)
  await tx.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_walletId_createdAt_idx" ON "wallet_ledger_entries"("walletId", "createdAt")
  `)
  await tx.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_providerId_createdAt_idx" ON "wallet_ledger_entries"("providerId", "createdAt")
  `)
  await tx.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_referenceType_referenceId_idx" ON "wallet_ledger_entries"("referenceType", "referenceId")
  `)
    await tx.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_isTestTransaction_createdAt_idx" ON "wallet_ledger_entries"("isTestTransaction", "createdAt")
    `)
}

function isTransactionApiError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error)
  return message.includes('Transaction API error: Transaction not found') || message.includes('P2028')
}

async function runWalletRebuildInRunner(tx: any): Promise<void> {
    const providerIds = new Set(
      (await tx.provider.findMany({
        select: { id: true },
      })).map((provider: { id: string }) => provider.id),
    )
    const activeProviderIds = new Set(
      (await tx.provider.findMany({
        where: { active: true },
        select: { id: true },
      })).map((provider: { id: string }) => provider.id),
    )

    console.log('\n── 1/7 backup source wallet state')
    const hasProviderWallets = await tableExists(WALLETS)
    const hasLedger = await tableExists(LEDGER)
    console.log(`Wallet table present: ${hasProviderWallets ? 'yes' : 'no'}`)
    console.log(`Ledger table present: ${hasLedger ? 'yes' : 'no'}`)

    if (hasProviderWallets) {
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROVIDER_WALLET_BACKUP}"`)
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${PROVIDER_WALLET_BACKUP}" (LIKE "${WALLETS}" INCLUDING ALL)`,
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO "${PROVIDER_WALLET_BACKUP}" SELECT * FROM "${WALLETS}"`,
      )
    }

    if (hasLedger) {
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${LEDGER_BACKUP}"`)
      await tx.$executeRawUnsafe(
        `CREATE TABLE "${LEDGER_BACKUP}" (LIKE "${LEDGER}" INCLUDING ALL)`,
      )
      await tx.$executeRawUnsafe(
        `INSERT INTO "${LEDGER_BACKUP}" SELECT * FROM "${LEDGER}"`,
      )
    }

    console.log('\n── 2/7 rebuild wallet schema objects')
    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${LEDGER}" CASCADE`)
    await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${WALLETS}" CASCADE`)
    await ensureCanonicalWalletSchema(tx)

    const restoredWalletColumns = await readLegacyColumns(PROVIDER_WALLET_BACKUP).catch(() => new Set<string>())
    const restoredLedgerColumns = await readLegacyColumns(LEDGER_BACKUP).catch(() => new Set<string>())
    console.log(`Wallet backup columns: ${restoredWalletColumns.size ? [...restoredWalletColumns].join(', ') : 'none'}`)
    console.log(`Ledger backup columns: ${restoredLedgerColumns.size ? [...restoredLedgerColumns].join(', ') : 'none'}`)

    console.log('\n── 3/7 restore provider_wallet from legacy snapshot')
    const legacyWalletRows = hasProviderWallets
      ? (await tx.$queryRawUnsafe<LegacyRow[]>(`SELECT * FROM "${PROVIDER_WALLET_BACKUP}"`))
      : []
    const mappedWallets = normalizeLegacyWalletRows(legacyWalletRows).filter((wallet) => providerIds.has(wallet.providerId))
    console.log(`Restoring ${mappedWallets.length} legacy wallet rows`)

    for (let i = 0; i < mappedWallets.length; i += 200) {
      const chunk = mappedWallets.slice(i, i + 200)
      await tx.providerWallet.createMany({ data: chunk, skipDuplicates: true })
    }

    console.log('\n── 4/7 guarantee active-provider wallets')
    const existingWalletProviderRows = await tx.providerWallet.findMany({
      select: { providerId: true },
    })
    const existingWalletProviderIds = new Set(existingWalletProviderRows.map((row: { providerId: string }) => row.providerId))
    const missingActive = [...activeProviderIds].filter((id) => !existingWalletProviderIds.has(id))
    if (missingActive.length > 0) {
      const defaultWalletRows: Prisma.ProviderWalletCreateManyInput[] = missingActive.map((providerId) => ({
        id: `${providerId}-repair-default`,
        providerId,
        paidCreditBalance: 0,
        promoCreditBalance: 0,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      await tx.providerWallet.createMany({ data: defaultWalletRows })
    }
    console.log(`Created ${missingActive.length} missing active-provider wallet rows`)

    console.log('\n── 5/7 restore wallet ledger entries')
    const restoredWallets = await tx.providerWallet.findMany({
      select: { id: true, providerId: true },
    })
    const walletByProviderId = new Map(restoredWallets.map((wallet: { id: string; providerId: string }) => [wallet.providerId, wallet.id]))
    const legacyLedgerRows = hasLedger
      ? (await tx.$queryRawUnsafe<LegacyRow[]>(`SELECT * FROM "${LEDGER_BACKUP}" ORDER BY "createdAt" ASC, "id" ASC`))
      : []
    const mappedLedgerRows = normalizeLegacyLedgerRows(legacyLedgerRows, walletByProviderId)
    const validLedgerRows = mappedLedgerRows.filter((entry) => providerIds.has(entry.providerId))

    for (let i = 0; i < validLedgerRows.length; i += 200) {
      const chunk = validLedgerRows.slice(i, i + 200)
      await tx.walletLedgerEntry.createMany({ data: chunk, skipDuplicates: true })
    }
    console.log(`Restored ${validLedgerRows.length} legacy ledger rows`)

    console.log('\n── 6/7 ensure post-rebuild constraints')
    // Drop old amountCredits > 0 constraint (installed by step 2 CREATE TABLE) and
    // replace it with the stricter per-type check from 20260430213000.
    await tx.$executeRawUnsafe(`
      ALTER TABLE "wallet_ledger_entries"
      DROP CONSTRAINT IF EXISTS "wallet_ledger_entries_amountCredits_positive"
    `)
    await tx.$executeRawUnsafe(`
      ALTER TABLE "wallet_ledger_entries"
      ADD CONSTRAINT "wallet_ledger_entries_amountCredits_valid_for_type"
      CHECK (
        (
          "entryType" IN (
            'TOPUP_CREDIT',
            'PROMO_CREDIT',
            'LEAD_UNLOCK_DEBIT',
            'LEAD_REFUND_CREDIT',
            'PROMO_EXPIRY',
            'PAYMENT_REVERSAL'
          )
          AND "amountCredits" > 0
        )
        OR (
          "entryType" = 'ADMIN_ADJUSTMENT'
          AND "amountCredits" <> 0
        )
        OR (
          "entryType" IN ('WALLET_SUSPENDED', 'WALLET_REACTIVATED')
          AND "amountCredits" = 0
        )
      )
    `)
    await tx.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "wallet_ledger_entries_referenceType_referenceId_idx"
      ON "wallet_ledger_entries"("referenceType", "referenceId")
    `)

    console.log('\n── 7/7 post-repair integrity summary')
    const activeWalletCoverage = await tx.$queryRawUnsafe<{ missing: number }[]>(`
      SELECT COUNT(*)::int AS missing
      FROM providers p
      WHERE p.active = true
        AND NOT EXISTS (
          SELECT 1
          FROM provider_wallets w
          WHERE w."providerId" = p.id
        )
    `)
    const walletCount = await tx.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM provider_wallets`)
    const ledgerCount = await tx.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM wallet_ledger_entries`)
    console.log(`Active providers without wallet rows: ${activeWalletCoverage[0]?.missing ?? 0}`)
    console.log(`provider_wallet row count: ${walletCount[0]?.count ?? 0}`)
    console.log(`wallet_ledger_entries row count: ${ledgerCount[0]?.count ?? 0}`)
  }

  async function runWalletRebuild(): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await runWalletRebuildInRunner(tx)
    })
  } catch (error) {
    if (isApply && isTransactionApiError(error)) {
      console.log('\nPrisma transaction mode failed with pooled connection API error. Retrying rebuild outside transaction...')
      await runWalletRebuildInRunner(db)
      return
    }

    throw error
  }
}

function printManualCommands() {
  console.log('\nPrisma migration repair command checklist:')
  for (const migration of WALLET_MIGRATIONS) {
    console.log(`  ${PRISMA_COMMAND.command} ${PRISMA_COMMAND.args.join(' ')} migrate resolve --applied ${migration}`)
  }
  console.log(`  ${PRISMA_COMMAND.command} ${PRISMA_COMMAND.args.join(' ')} migrate status`)
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    console.log(`
Wallet schema drift repair utility

Usage:
  pnpm exec tsx scripts/wallet-schema-drift-repair.ts [--apply] [--resolve-migrations] [--prisma-cmd-pnpm] [--help]

--apply:
  execute database writes; without --apply only a plan/snapshot is printed.

--resolve-migrations:
  when combined with --apply, mark wallet-related migration rows as applied via Prisma migrate resolve.

--prisma-cmd-pnpm:
  use \`pnpm exec prisma\` for resolve/status commands; default is \`npx prisma\`.
`)
    return
  }

  console.log('\n── Wallet migration drift preflight snapshot')
  const providerCount = await db.provider.count()
  const walletExists = await tableExists(WALLETS)
  const ledgerExists = await tableExists(LEDGER)
  const migrationRows = await fetchMigrationRows()
  const dependencyTableCounts = await Promise.all(
    WALLET_DEPENDENCY_TABLES.map(async (tableName) => ({
      tableName,
      count: await safeTableCount(tableName),
    })),
  )

  if (walletExists) {
    const providerWalletRows = await db.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM "${WALLETS}"`)
    const walletLedgerRows = await db.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM "${LEDGER}"`)
    const activeWalletCoverage = await db.$queryRawUnsafe<{ missing: number }[]>(`
      SELECT COUNT(*)::int AS missing
      FROM providers p
      LEFT JOIN "${WALLETS}" w ON w."providerId" = p.id
      WHERE p.active = true
        AND w.id IS NULL
    `)
    console.log(`Providers total: ${providerCount}`)
    console.log(`provider_wallet rows: ${providerWalletRows[0]?.count ?? 0}`)
    console.log(`wallet_ledger_entries rows: ${walletLedgerRows[0]?.count ?? 0}`)
    console.log(`active providers without wallet rows: ${activeWalletCoverage[0]?.missing ?? 0}`)
  } else {
    console.log(`Providers total: ${providerCount}`)
    console.log('provider_wallet rows: 0 (table currently missing)')
    console.log('wallet_ledger_entries rows: 0 (table currently missing)')
    console.log('active providers without wallet rows: unknown until repair')
  }

  for (const { tableName, count } of dependencyTableCounts) {
    console.log(`\nDependency table ${tableName} row count: ${count}`)
  }

  console.log(`\nLegacy backups configured: ${walletExists || ledgerExists ? 'possible' : 'new tables will be created if missing'}`)
  console.log(`Legacy backup target tables: ${PROVIDER_WALLET_BACKUP}, ${LEDGER_BACKUP}`)
  await printMigrationStatus(migrationRows)

  if (!isApply) {
    console.log('\nDry run mode: no database writes executed.')
    printManualCommands()
    return
  }

  if (!force && !args.has('--confirm')) {
    console.log('\nWrite mode requires explicit --confirm.')
    console.log('Re-run with: --apply --confirm [--resolve-migrations]')
    return
  }

  console.log('\nApplying repair transaction...')
  await runWalletRebuild()
  console.log('Wallet schema repair transaction committed.')

  if (resolveMigrations) {
    for (const migration of WALLET_MIGRATIONS) {
      const state = migrationState(migrationRows.get(migration))
      if (state !== 'APPLIED') {
        await runCommand(PRISMA_COMMAND.command, [...PRISMA_COMMAND.args, 'migrate', 'resolve', '--applied', migration])
      }
    }
    // Re-read current migration status after resolve updates.
    const refreshed = await fetchMigrationRows()
    await printMigrationStatus(refreshed)
  }

  const activeWalletCoverage = await db.$queryRawUnsafe<{ missing: number }[]>(`
    SELECT COUNT(*)::int AS missing
    FROM providers p
    WHERE p.active = true
      AND NOT EXISTS (
        SELECT 1
        FROM provider_wallets w
        WHERE w."providerId" = p.id
      )
  `)
  const walletCount = await db.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM provider_wallets`)
  const ledgerCount = await db.$queryRawUnsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM wallet_ledger_entries`)
  console.log('\nPost-repair smoke snapshot:')
  console.log(`Active providers missing wallet rows: ${activeWalletCoverage[0]?.missing ?? 0}`)
  console.log(`provider_wallet rows: ${walletCount[0]?.count ?? 0}`)
  console.log(`wallet_ledger_entries rows: ${ledgerCount[0]?.count ?? 0}`)
  console.log(`Legacy wallets backed up to: ${PROVIDER_WALLET_BACKUP}`)
  console.log(`Legacy ledger entries backed up to: ${LEDGER_BACKUP}`)
  printManualCommands()
}

main()
  .catch((error) => {
    console.error('\nWallet repair failed:', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
