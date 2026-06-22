// Daily Customer Funnel Report — Tier 1.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// Mirrors the daily-provider-funnel-report.ts shell. Bypasses the admin-page
// feature flag because operators run this directly. Tier 1 ships as a manual
// CLI tool — Vercel cron wiring is deferred per spec §9.
//
// Usage:
//   pnpm tsx scripts/daily-customer-funnel-report.ts
//   pnpm tsx scripts/daily-customer-funnel-report.ts --days=7
//   pnpm tsx scripts/daily-customer-funnel-report.ts --json

import { db } from '../lib/db'
import {
  biggestLeak,
  fetchFunnelByService,
  fetchFunnelBySuburb,
  fetchFunnelCounts,
  fetchNotificationHealth,
} from '../lib/admin/funnel-aggregate'

const JSON_OUTPUT = process.argv.includes('--json')

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='))
  if (!arg) return 1
  const value = Number(arg.slice('--days='.length))
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.floor(value)
}

function pad(value: number | string, width: number): string {
  const str = String(value)
  if (str.length >= width) return str
  return ' '.repeat(width - str.length) + str
}

function formatPct(numerator: number, denominator: number): string {
  if (!denominator) return '   —'
  const pct = Math.round((numerator / denominator) * 100)
  return `${pad(pct, 3)}%`
}

async function main() {
  const days = parseDays()
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const [counts, byService, bySuburb, notif] = await Promise.all([
    fetchFunnelCounts({ from, to }),
    fetchFunnelByService({ from, to }, db, 10),
    fetchFunnelBySuburb({ from, to }, db, 10),
    fetchNotificationHealth({ from, to }),
  ])

  const zeroEligible = counts.matchAttempted - counts.matchedToProvider
  const matchedNoAccept = counts.matchedToProvider - counts.providerAccepted
  const acceptedNoNotify = counts.providerAccepted - counts.clientNotified
  const leak = biggestLeak(counts)

  if (JSON_OUTPUT) {
    const payload = {
      window: { from: from.toISOString(), to: to.toISOString(), days },
      funnel: counts,
      conversions: {
        started_to_submitted: counts.started > 0 ? counts.submitted / counts.started : null,
        submitted_to_matched: counts.submitted > 0 ? counts.matchAttempted / counts.submitted : null,
        matched_to_eligible: counts.matchAttempted > 0 ? counts.matchedToProvider / counts.matchAttempted : null,
        eligible_to_accepted: counts.matchedToProvider > 0 ? counts.providerAccepted / counts.matchedToProvider : null,
        accepted_to_notified: counts.providerAccepted > 0 ? counts.clientNotified / counts.providerAccepted : null,
      },
      ops_action_items: {
        submitted_with_zero_eligible: zeroEligible,
        providers_notified_no_acceptance: matchedNoAccept,
        accepted_but_client_not_notified: acceptedNoNotify,
      },
      by_service: byService,
      by_suburb: bySuburb,
      notification_health: notif,
      biggest_leak: leak,
    }
    process.stdout.write(JSON.stringify(payload, null, 2))
    process.stdout.write('\n')
    return
  }

  const banner = `========== Plug A Pro — Customer Funnel — last ${days}d ==========`
  console.log(banner)
  console.log(`Window: ${from.toISOString().slice(0, 16).replace('T', ' ')} → ${to.toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  console.log()

  console.log('Funnel')
  console.log(`  REQUEST_STARTED       ${pad(counts.started, 6)}     (-)`)
  console.log(`  REQUEST_SUBMITTED     ${pad(counts.submitted, 6)}  → ${formatPct(counts.submitted, counts.started)} from started`)
  console.log(`  MATCH_ATTEMPTED       ${pad(counts.matchAttempted, 6)}  → ${formatPct(counts.matchAttempted, counts.submitted)}`)
  const eligLine = `  ≥1 ELIGIBLE PROVIDER  ${pad(counts.matchedToProvider, 6)}  → ${formatPct(counts.matchedToProvider, counts.matchAttempted)}`
  console.log(zeroEligible > 0 ? `${eligLine}   ⚠ ${zeroEligible} with zero eligible` : eligLine)
  const acceptLine = `  PROVIDER_ACCEPTED     ${pad(counts.providerAccepted, 6)}  → ${formatPct(counts.providerAccepted, counts.matchedToProvider)}`
  console.log(matchedNoAccept > 0 ? `${acceptLine}   ⚠ ${matchedNoAccept} matched-but-not-accepted` : acceptLine)
  const notifyLine = `  CLIENT_NOTIFIED       ${pad(counts.clientNotified, 6)}  → ${formatPct(counts.clientNotified, counts.providerAccepted)}`
  console.log(acceptedNoNotify > 0 ? `${notifyLine}   ⚠ ${acceptedNoNotify} accepted-but-not-notified` : notifyLine)
  console.log()

  if (leak) {
    console.log(`Top leak: ${leak.fromStage} → ${leak.toStage} (${Math.round(leak.ratio * 100)}% drop, ${leak.dropped} requests)`)
    console.log()
  }

  console.log('By service (submitted → accepted)')
  if (byService.length === 0) {
    console.log('  (no data)')
  } else {
    for (const row of byService) {
      console.log(`  ${row.key.padEnd(18)} ${pad(row.submitted, 4)}  →  ${pad(row.accepted, 4)}  (${Math.round(row.conversionRate * 100)}%)`)
    }
  }
  console.log()

  console.log('By suburb (submitted → accepted)')
  if (bySuburb.length === 0) {
    console.log('  (no data)')
  } else {
    for (const row of bySuburb) {
      console.log(`  ${row.key.padEnd(18)} ${pad(row.submitted, 4)}  →  ${pad(row.accepted, 4)}  (${Math.round(row.conversionRate * 100)}%)`)
    }
  }
  console.log()

  console.log(`Notification health (${days}d)`)
  console.log(`  SENT      ${pad(notif.sent, 5)}`)
  console.log(`  DELIVERED ${pad(notif.delivered, 5)}`)
  console.log(`  READ      ${pad(notif.read, 5)}`)
  const failedLine = `  FAILED    ${pad(notif.failed, 5)}`
  if (notif.byTemplate.length > 0) {
    const templates = notif.byTemplate.map((t) => `${t.templateName} x${t.failed}`).join(', ')
    console.log(`${failedLine}   ← templates: ${templates}`)
  } else {
    console.log(failedLine)
  }
  console.log()

  console.log('Ops action items')
  if (zeroEligible > 0) console.log(`  - ${zeroEligible} requests submitted with ZERO eligible providers`)
  if (matchedNoAccept > 0) console.log(`  - ${matchedNoAccept} requests with providers notified but no acceptance`)
  if (acceptedNoNotify > 0) console.log(`  - ${acceptedNoNotify} requests accepted but client never notified`)
  if (zeroEligible === 0 && matchedNoAccept === 0 && acceptedNoNotify === 0) {
    console.log('  (none — funnel is clean for this window)')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[daily-customer-funnel-report] failed:', err)
    process.exit(1)
  })
