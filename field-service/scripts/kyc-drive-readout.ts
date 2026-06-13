// KYC drive readout — the flip-decision instrument for retiring the
// matching.kyc_grace_legacy_providers flag (see lib/matching/kyc-grace.ts).
// Flip the grace flag OFF only when this prints READY, and resolve the listed
// stragglers explicitly (manual-verify, extend, or deactivate) first.
//
// Usage: npx tsx scripts/kyc-drive-readout.ts [--legacy-target 0.9] [--category-floor 3]

import { PrismaClient } from '@prisma/client'
import { KYC_GRACE_CUTOFF } from '../lib/matching/kyc-grace'

const db = new PrismaClient()

function argNumber(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

async function main() {
  const legacyTarget = argNumber('--legacy-target', 0.9)
  const categoryFloor = argNumber('--category-floor', 3)

  const providers = await db.provider.findMany({
    where: { active: true, verified: true, status: 'ACTIVE', isTestUser: false },
    select: {
      id: true,
      firstName: true,
      name: true,
      phone: true,
      kycStatus: true,
      createdAt: true,
      skills: true,
    },
  })

  const legacy = providers.filter(p => p.createdAt < KYC_GRACE_CUTOFF)
  const postCutoff = providers.filter(p => p.createdAt >= KYC_GRACE_CUTOFF)
  const legacyVerified = legacy.filter(p => p.kycStatus === 'VERIFIED')
  const completion = legacy.length ? legacyVerified.length / legacy.length : 1

  const byStatus = (cohort: typeof providers) => {
    const counts = new Map<string, number>()
    for (const p of cohort) {
      const k = p.kycStatus ?? 'NOT_STARTED'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }

  console.log('=== KYC DRIVE READOUT ===')
  console.log(`Cutoff: ${KYC_GRACE_CUTOFF.toISOString()}`)

  console.log(`\nLegacy cohort (pre-cutoff, grandfathered while grace is ON): ${legacy.length}`)
  console.log(`  Completion: ${legacyVerified.length}/${legacy.length} VERIFIED (${(completion * 100).toFixed(1)}%)`)
  for (const [status, n] of byStatus(legacy)) console.log(`    ${status}: ${n}`)

  console.log(`\nPost-cutoff providers (always require VERIFIED, unaffected by the flip): ${postCutoff.length}`)
  for (const [status, n] of byStatus(postCutoff)) console.log(`    ${status}: ${n}`)

  // Per-skill VERIFIED coverage, case-normalized — provider.skills contains
  // mixed-case duplicates of the same category ("Painting" vs "painting").
  const skillTotals = new Map<string, { total: number; verified: number }>()
  for (const p of providers) {
    for (const raw of p.skills ?? []) {
      const skill = raw.trim().toLowerCase()
      if (!skill) continue
      const row = skillTotals.get(skill) ?? { total: 0, verified: 0 }
      row.total += 1
      if (p.kycStatus === 'VERIFIED') row.verified += 1
      skillTotals.set(skill, row)
    }
  }

  console.log(`\nPer-skill VERIFIED coverage (floor: ${categoryFloor}):`)
  const blockers: string[] = []
  for (const [skill, row] of [...skillTotals.entries()].sort((a, b) => a[1].verified - b[1].verified)) {
    const ok = row.verified >= categoryFloor
    if (!ok) blockers.push(skill)
    console.log(`  ${ok ? 'ok ' : 'LOW'} ${skill}: ${row.verified}/${row.total} verified`)
  }

  const stragglers = legacy.filter(p => p.kycStatus !== 'VERIFIED')
  console.log(`\nLegacy stragglers (${stragglers.length}) — resolve each explicitly before the flip:`)
  for (const p of stragglers) {
    const label = p.firstName ?? p.name ?? p.id
    console.log(`  ${label} ${p.phone} — ${p.kycStatus ?? 'NOT_STARTED'} (joined ${p.createdAt.toISOString().slice(0, 10)})`)
  }

  const legacyReady = completion >= legacyTarget
  const coverageReady = blockers.length === 0
  console.log('\n=== FLIP READINESS ===')
  console.log(`Legacy completion >= ${(legacyTarget * 100).toFixed(0)}%: ${legacyReady ? 'YES' : `NO (at ${(completion * 100).toFixed(1)}%)`}`)
  console.log(`Every skill >= ${categoryFloor} verified: ${coverageReady ? 'YES' : `NO (${blockers.join(', ')})`}`)
  console.log(
    legacyReady && coverageReady
      ? '\nREADY — resolve the stragglers above, then set matching.kyc_grace_legacy_providers OFF (DB flag row).'
      : '\nNOT READY — keep matching.kyc_grace_legacy_providers ON.',
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
