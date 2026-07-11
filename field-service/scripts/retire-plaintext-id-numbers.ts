#!/usr/bin/env tsx
// Retire (null) the plaintext ProviderApplication.idNumber column AFTER the
// encrypted backfill has been run and verified (SEC-01 / P0-7, POPIA §26).
//
// Default is --dry-run: prints verification counts, writes NOTHING.
// Usage:
//   pnpm tsx scripts/retire-plaintext-id-numbers.ts             # dry-run
//   pnpm tsx scripts/retire-plaintext-id-numbers.ts --execute   # null verified plaintext
//
// Safety contract (user mandate: NO DATA LOSS):
//   - Only nulls plaintext on rows whose ciphertext round-trip-decrypts to the
//     EXACT plaintext value.
//   - If ANY row with plaintext fails verification (missing ciphertext, tamper,
//     mismatch), --execute REFUSES to write anything at all and exits 1.
//     Re-run scripts/backfill-id-number-encryption.ts first.
//   - Refuses to run when PII_ENC_KEY is not configured.
//   - Never logs plaintext ID numbers or ciphertext contents — ids and counts only.

import { PII_ENC_KEY_ENV, decryptIdNumber, isPiiEncryptionConfigured } from '@/lib/pii-crypto'

// ─── Pure classification logic (unit-tested) ─────────────────────────────────

export interface RetireRow {
  id: string
  idNumber: string | null
  idNumberCiphertext: string | null
}

export type RetireClassification =
  | 'retire' // plaintext present, ciphertext verified — safe to null plaintext
  | 'already_retired' // no plaintext left on the row
  | 'fail_no_ciphertext' // plaintext present but never encrypted — backfill first
  | 'fail_verification' // ciphertext present but does not decrypt to the plaintext

export function classifyRetireRow(
  row: RetireRow,
  decrypt: (ciphertext: string) => string = decryptIdNumber,
): RetireClassification {
  if (!row.idNumber || row.idNumber.trim() === '') return 'already_retired'
  if (!row.idNumberCiphertext || row.idNumberCiphertext.trim() === '') return 'fail_no_ciphertext'
  try {
    return decrypt(row.idNumberCiphertext) === row.idNumber ? 'retire' : 'fail_verification'
  } catch {
    return 'fail_verification'
  }
}

export interface RetirePlan {
  retire: string[]
  alreadyRetired: number
  failNoCiphertext: string[]
  failVerification: string[]
}

export function planRetirement(
  rows: RetireRow[],
  decrypt: (ciphertext: string) => string = decryptIdNumber,
): RetirePlan {
  const plan: RetirePlan = { retire: [], alreadyRetired: 0, failNoCiphertext: [], failVerification: [] }
  for (const row of rows) {
    const cls = classifyRetireRow(row, decrypt)
    if (cls === 'retire') plan.retire.push(row.id)
    else if (cls === 'already_retired') plan.alreadyRetired += 1
    else if (cls === 'fail_no_ciphertext') plan.failNoCiphertext.push(row.id)
    else plan.failVerification.push(row.id)
  }
  return plan
}

/** True when it is safe for --execute to write: zero verification failures. */
export function canExecuteRetirement(plan: RetirePlan): boolean {
  return plan.failNoCiphertext.length === 0 && plan.failVerification.length === 0
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute')

  if (!isPiiEncryptionConfigured()) {
    console.error(`[retire-plaintext-id-numbers] ${PII_ENC_KEY_ENV} is not configured — refusing to run.`)
    process.exit(1)
  }

  // Dynamic import keeps PrismaClient out of unit tests of the pure logic above
  // (same pattern as scripts/application-triage-sweep.ts).
  const { db } = await import('@/lib/db')

  try {
    const rows: RetireRow[] = await db.providerApplication.findMany({
      select: { id: true, idNumber: true, idNumberCiphertext: true },
    })

    const plan = planRetirement(rows)
    console.log('[retire-plaintext-id-numbers] verification state:')
    console.log(`  total rows:              ${rows.length}`)
    console.log(`  verified, retireable:    ${plan.retire.length}`)
    console.log(`  already retired:         ${plan.alreadyRetired}`)
    console.log(`  FAIL missing ciphertext: ${plan.failNoCiphertext.length}`)
    console.log(`  FAIL verification:       ${plan.failVerification.length}`)
    for (const id of [...plan.failNoCiphertext, ...plan.failVerification]) {
      console.log(`    failing application: ${id}`)
    }

    if (!canExecuteRetirement(plan)) {
      console.error(
        '\n[retire-plaintext-id-numbers] verification failures present — refusing to retire ANY row. Run scripts/backfill-id-number-encryption.ts --execute and retry.',
      )
      process.exitCode = 1
      return
    }

    if (!execute) {
      console.log('\n[dry-run] All rows verified. Pass --execute to null the plaintext column on verified rows.')
      return
    }

    const result = await db.providerApplication.updateMany({
      where: { id: { in: plan.retire } },
      data: { idNumber: null },
    })

    console.log(`\n[retire-plaintext-id-numbers] done: plaintext nulled on ${result.count} rows (expected ${plan.retire.length}).`)
  } finally {
    await db.$disconnect()
  }
}

// Run CLI when invoked directly (tsx scripts/retire-plaintext-id-numbers.ts)

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('[retire-plaintext-id-numbers] fatal:', err)
    process.exit(1)
  })
}
