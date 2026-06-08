/**
 * audit-provider-kyc-status.ts
 *
 * Finds providers whose Provider.kycStatus is stale relative to their latest
 * ProviderIdentityVerification.status (typically: kycStatus still NOT_STARTED
 * while the inner verification has progressed). Prints a reviewable table.
 *
 * Background: until 2026-06-08 the orchestrator only propagated terminal
 * verification states (PASSED/FAILED/EXPIRED) to Provider.kycStatus, so any
 * provider mid-flow appears stuck at "Identity not started" on the badge.
 * This script identifies those records using the same resolveKycStatusUpdate
 * rule as the orchestrator does post-fix, so re-running after applying never
 * produces "drift".
 *
 * Production safety:
 *   - Defaults to DRY RUN. Prints the proposed change for every affected
 *     provider and exits without writing.
 *   - Pass --apply to actually update kycStatus.
 *   - Never deletes, never overwrites VERIFIED, never touches identity
 *     documents or PII. Only the Provider.kycStatus column is changed.
 *   - Logs every applied change with provider id, name, last-4 phone, and
 *     status transition.
 *
 * Usage:
 *   npx tsx scripts/audit-provider-kyc-status.ts                # dry-run
 *   npx tsx scripts/audit-provider-kyc-status.ts --apply        # apply
 *   npx tsx scripts/audit-provider-kyc-status.ts --provider <id> # single
 */

import 'dotenv/config'
import { db } from '../lib/db'
import {
  kycStatusForVerificationStatus,
  resolveKycStatusUpdate,
} from '../lib/identity-verification/kyc-status'

type Row = {
  providerId: string
  name: string
  phoneTail: string
  currentKyc: string
  verificationStatus: string
  verificationDecision: string | null
  evidence: string
  recommendedKyc: string
  reason: string
  verificationUpdatedAt: string
}

function phoneTail(phone: string): string {
  return phone.length >= 4 ? phone.slice(-4) : phone
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const isApply = args.has('--apply')
  const providerArgIndex = process.argv.indexOf('--provider')
  const singleProviderId =
    providerArgIndex >= 0 && process.argv[providerArgIndex + 1]
      ? process.argv[providerArgIndex + 1]
      : null

  console.log(`Identity kycStatus audit — ${isApply ? 'APPLY' : 'DRY-RUN'}`)
  if (singleProviderId) {
    console.log(`Scoped to provider id: ${singleProviderId}`)
  }

  const providers = await db.provider.findMany({
    where: {
      ...(singleProviderId ? { id: singleProviderId } : {}),
      identityVerifications: { some: { status: { not: 'NOT_STARTED' } } },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      kycStatus: true,
      identityVerifications: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          decision: true,
          updatedAt: true,
          _count: { select: { documents: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const rows: Row[] = []
  for (const provider of providers) {
    const latest = provider.identityVerifications[0]
    if (!latest) continue
    const target = kycStatusForVerificationStatus(latest.status, latest.decision)
    const next = resolveKycStatusUpdate(provider.kycStatus, target)
    if (!next) continue
    rows.push({
      providerId: provider.id,
      name: provider.name,
      phoneTail: phoneTail(provider.phone),
      currentKyc: provider.kycStatus,
      verificationStatus: latest.status,
      verificationDecision: latest.decision ?? null,
      evidence: `${latest._count.documents} doc(s)`,
      recommendedKyc: next,
      reason: `${provider.kycStatus} -> ${next} (verification at ${latest.status}${
        latest.decision ? `/${latest.decision}` : ''
      })`,
      verificationUpdatedAt: latest.updatedAt.toISOString(),
    })
  }

  if (rows.length === 0) {
    console.log('No providers require kycStatus correction. Nothing to do.')
    return
  }

  console.table(
    rows.map((row) => ({
      providerId: row.providerId,
      name: row.name,
      phoneTail: `***${row.phoneTail}`,
      currentKyc: row.currentKyc,
      verification: `${row.verificationStatus}${row.verificationDecision ? `/${row.verificationDecision}` : ''}`,
      evidence: row.evidence,
      recommendedKyc: row.recommendedKyc,
      updatedAt: row.verificationUpdatedAt,
    })),
  )
  console.log(`\n${rows.length} provider(s) recommended for kycStatus correction.`)

  if (!isApply) {
    console.log('\nDry-run only. Re-run with --apply to write the recommended kycStatus.')
    return
  }

  console.log('\nApplying corrections...')
  let applied = 0
  for (const row of rows) {
    // Re-resolve under a transaction to guard against concurrent updates
    // (another admin manually setting kycStatus between dry-run and apply).
    await db.$transaction(async (tx) => {
      const fresh = await tx.provider.findUnique({
        where: { id: row.providerId },
        select: { kycStatus: true },
      })
      if (!fresh) {
        console.warn(`  skip ${row.providerId}: provider no longer exists`)
        return
      }
      const reResolved = resolveKycStatusUpdate(fresh.kycStatus, row.recommendedKyc as never)
      if (!reResolved) {
        console.warn(`  skip ${row.providerId}: state changed since dry-run (now ${fresh.kycStatus})`)
        return
      }
      await tx.provider.update({
        where: { id: row.providerId },
        data: { kycStatus: reResolved },
      })
      applied += 1
      console.log(
        `  applied ${row.providerId} (${row.name}, ***${row.phoneTail}): ${fresh.kycStatus} -> ${reResolved}`,
      )
    })
  }
  console.log(`\nDone. ${applied}/${rows.length} provider(s) updated.`)
}

main()
  .catch((err) => {
    console.error('audit-provider-kyc-status failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
