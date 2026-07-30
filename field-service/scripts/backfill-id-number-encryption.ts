#!/usr/bin/env tsx
// Backfill idNumberCiphertext + idNumberLast4 for existing ProviderApplication
// rows that still carry a plaintext idNumber (SEC-01 / P0-7, POPIA §26).
//
// Default is --dry-run: prints counts, writes NOTHING.
// Usage:
//   pnpm tsx scripts/backfill-id-number-encryption.ts             # dry-run
//   pnpm tsx scripts/backfill-id-number-encryption.ts --execute   # encrypt + write
//
// Safety contract:
//   - NEVER touches the plaintext idNumber column (retirement is a separate,
//     manual script: scripts/retire-plaintext-id-numbers.ts).
//   - Every written ciphertext is round-trip verified (decrypt === plaintext)
//     BEFORE the row counts as a success; a mismatch aborts that row.
//   - Refuses to run at all when PII_ENC_KEY is not configured.
//   - Never logs plaintext ID numbers or ciphertext contents — ids and counts only.

import {
  PII_ENC_KEY_ENV,
  decryptIdNumber,
  encryptIdNumber,
  isPiiEncryptionConfigured,
} from '@/lib/pii-crypto'
import { idNumberLast4 } from '@/lib/pii-id-number'

// ─── Pure selection/verification logic (unit-tested) ─────────────────────────

export interface BackfillRow {
  id: string
  idNumber: string | null
  idNumberCiphertext: string | null
}

export type BackfillClassification =
  | 'needs_encryption' // plaintext present, no ciphertext yet
  | 'already_encrypted' // ciphertext already present (idempotent skip)
  | 'no_plaintext' // nothing to encrypt

export function classifyBackfillRow(row: BackfillRow): BackfillClassification {
  if (row.idNumberCiphertext && row.idNumberCiphertext.trim() !== '') return 'already_encrypted'
  if (row.idNumber && row.idNumber.trim() !== '') return 'needs_encryption'
  return 'no_plaintext'
}

export interface BackfillPlan {
  needsEncryption: string[]
  alreadyEncrypted: number
  noPlaintext: number
}

export function planBackfill(rows: BackfillRow[]): BackfillPlan {
  const plan: BackfillPlan = { needsEncryption: [], alreadyEncrypted: 0, noPlaintext: 0 }
  for (const row of rows) {
    const cls = classifyBackfillRow(row)
    if (cls === 'needs_encryption') plan.needsEncryption.push(row.id)
    else if (cls === 'already_encrypted') plan.alreadyEncrypted += 1
    else plan.noPlaintext += 1
  }
  return plan
}

/**
 * Encrypt one plaintext value and round-trip verify it. Returns the writable
 * columns, or null when verification fails (caller must NOT write).
 */
export function encryptAndVerify(
  plaintext: string,
  encrypt: (plain: string) => string = encryptIdNumber,
  decrypt: (ciphertext: string) => string = decryptIdNumber,
): { idNumberCiphertext: string; idNumberLast4: string } | null {
  const ciphertext = encrypt(plaintext)
  let roundTrip: string
  try {
    roundTrip = decrypt(ciphertext)
  } catch {
    return null
  }
  if (roundTrip !== plaintext) return null
  return { idNumberCiphertext: ciphertext, idNumberLast4: idNumberLast4(plaintext) }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute')

  if (!isPiiEncryptionConfigured()) {
    console.error(`[backfill-id-number-encryption] ${PII_ENC_KEY_ENV} is not configured — refusing to run.`)
    process.exit(1)
  }

  // Dynamic import keeps PrismaClient out of unit tests of the pure logic above
  // (same pattern as scripts/application-triage-sweep.ts).
  const { db } = await import('@/lib/db')

  try {
    const rows: BackfillRow[] = await db.providerApplication.findMany({
      select: { id: true, idNumber: true, idNumberCiphertext: true },
    })

    const plan = planBackfill(rows)
    console.log('[backfill-id-number-encryption] queue state:')
    console.log(`  total rows:          ${rows.length}`)
    console.log(`  needs encryption:    ${plan.needsEncryption.length}`)
    console.log(`  already encrypted:   ${plan.alreadyEncrypted}`)
    console.log(`  no plaintext:        ${plan.noPlaintext}`)

    if (!execute) {
      console.log('\n[dry-run] Pass --execute to encrypt. Plaintext column is never modified by this script.')
      return
    }

    const byId = new Map(rows.map((r) => [r.id, r]))
    let succeeded = 0
    let failedVerification = 0

    for (const id of plan.needsEncryption) {
      const row = byId.get(id)
      const plaintext = row?.idNumber
      if (!plaintext) continue

      const columns = encryptAndVerify(plaintext)
      if (!columns) {
        failedVerification += 1
        console.error(`  FAIL round-trip verification for application ${id} — row skipped, nothing written`)
        continue
      }

      await db.providerApplication.update({
        where: { id },
        data: columns, // ciphertext + last4 only; plaintext untouched
      })
      succeeded += 1
    }

    console.log(`\n[backfill-id-number-encryption] done: encrypted=${succeeded} failed_verification=${failedVerification}`)
    if (failedVerification > 0) {
      process.exitCode = 1
    }
  } finally {
    await db.$disconnect()
  }
}

// Run CLI when invoked directly (tsx scripts/backfill-id-number-encryption.ts)

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error('[backfill-id-number-encryption] fatal:', err)
    process.exit(1)
  })
}
