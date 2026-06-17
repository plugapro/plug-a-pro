/**
 * Provider Quality Report — founder-facing baseline. Prints to stdout.
 *
 * Read-only: this script never sends a WhatsApp or mutates DB.
 *
 * Usage:
 *   npx tsx field-service/scripts/provider-quality-report.ts
 *
 * Or via the Supabase Management API path documented in
 * .claude/projects/-Users-shimane-Projects-Plug-A-Pro/memory/reference_db_access.md
 * when DATABASE_URL is unreachable locally.
 */

import { getQualityCounts, loadProviderQualityRows } from '../lib/provider-quality/queries'
import {
  QUALITY_DIMENSION_LABEL,
  QUALITY_DIMENSIONS,
  type QualityDimension,
} from '../lib/provider-quality/quality'
import { previewNudges } from '../lib/provider-quality/orchestrator'

function fmt(n: number, total: number) {
  if (total === 0) return `${n} (0%)`
  return `${n} (${Math.round((n / total) * 100)}%)`
}

async function main() {
  const [counts, rows, preview] = await Promise.all([
    getQualityCounts(),
    loadProviderQualityRows(),
    previewNudges(),
  ])

  console.log('Provider Quality Report')
  console.log('=======================')
  console.log(new Date().toISOString())
  console.log('')

  console.log('Headline')
  console.log('--------')
  console.log(`Total providers: ${counts.totalProviders}`)
  console.log(`Active: ${counts.active}`)
  console.log(`Quality-ready: ${fmt(counts.qualityReady, counts.totalProviders)}`)
  console.log('')

  console.log('KYC / identity verification')
  console.log('---------------------------')
  console.log(`Verified: ${fmt(counts.kycVerified, counts.totalProviders)}`)
  console.log(`In progress: ${counts.kycInProgress}`)
  console.log(`Needs review: ${counts.kycNeedsReview}`)
  console.log(`Failed / expired: ${counts.kycFailed}`)
  console.log(`Not started: ${fmt(counts.kycNotStarted, counts.totalProviders)}`)
  console.log('')

  console.log('Profile + evidence')
  console.log('------------------')
  console.log(`Profile photo present: ${fmt(counts.withProfilePhoto, counts.totalProviders)}`)
  console.log(`Profile photo missing: ${counts.missingProfilePhoto}`)
  console.log(`Portfolio evidence present: ${fmt(counts.withPortfolioEvidence, counts.totalProviders)}`)
  console.log(`Portfolio evidence missing: ${counts.missingPortfolioEvidence}`)
  console.log('')

  console.log('High-risk + regulated skills')
  console.log('----------------------------')
  console.log(`Providers with at least one high-risk/regulated skill: ${counts.highRiskProviders}`)
  if (counts.highRiskProviders > 0) {
    console.log(`  with cert evidence: ${fmt(counts.highRiskWithCert, counts.highRiskProviders)}`)
    console.log(`  evidence under review: ${counts.highRiskNeedsReview}`)
    console.log(`  missing cert evidence: ${fmt(counts.highRiskMissingCert, counts.highRiskProviders)}`)
  }
  console.log('')

  console.log('Nudge preview (dry-run, no sends)')
  console.log('---------------------------------')
  console.log(`Providers considered: ${preview.totalProvidersConsidered}`)
  console.log(`Sendable now: ${preview.totalSendable}`)
  console.log(`Blocked (dedup / cap / no phone): ${preview.totalBlocked}`)
  const byTemplate = preview.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.plan.templateName] = (acc[item.plan.templateName] ?? 0) + 1
    return acc
  }, {})
  for (const [name, count] of Object.entries(byTemplate)) {
    console.log(`  ${name}: ${count}`)
  }
  console.log('')

  console.log('Top 10 missing-item providers (sorted by recommended-nudge priority)')
  console.log('-------------------------------------------------------------------')
  const sortable = rows
    .filter((r) => r.snapshot.missingItems.length > 0 && r.provider.active)
    .sort((a, b) => a.snapshot.missingItems.length - b.snapshot.missingItems.length)
    .slice(0, 10)
  for (const r of sortable) {
    const items = r.snapshot.missingItems.map((d) => QUALITY_DIMENSION_LABEL[d as QualityDimension]).join(', ')
    const phoneTail = r.provider.phone?.slice(-4) ?? '—'
    console.log(`  ${r.provider.name ?? r.provider.id} (…${phoneTail}): missing ${items}`)
  }

  await (await import('../lib/db')).db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await (await import('../lib/db')).db.$disconnect().catch(() => {})
  process.exit(1)
})

void QUALITY_DIMENSIONS // silence unused-import linter; kept for symmetry with quality.ts
