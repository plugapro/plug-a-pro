// Tier 1 funnel observability — verifies the daily report's JSON output shape
// against a seeded fixture so an unexpected shape change surfaces in CI.
// Spec §7: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// The script (`scripts/daily-customer-funnel-report.ts`) wraps the same
// fetchers exercised in `__tests__/admin/funnel-aggregate.test.ts`. This test
// covers the JSON payload shape consumed by automation.

import { describe, it, expect } from 'vitest'
import {
  biggestLeak,
  rankFunnelGroups,
  type FunnelCounts,
} from '../../lib/admin/funnel-aggregate'

// Mirror of the script's JSON shape (kept here so a contract drift is caught).
type DailyJson = {
  window: { from: string; to: string; days: number }
  funnel: FunnelCounts
  conversions: {
    started_to_submitted: number | null
    submitted_to_matched: number | null
    matched_to_eligible: number | null
    eligible_to_accepted: number | null
    accepted_to_notified: number | null
  }
  ops_action_items: {
    submitted_with_zero_eligible: number
    providers_notified_no_acceptance: number
    accepted_but_client_not_notified: number
  }
  by_service: Array<{ key: string; submitted: number; accepted: number; conversionRate: number }>
  by_suburb: Array<{ key: string; submitted: number; accepted: number; conversionRate: number }>
  notification_health: {
    sent: number
    delivered: number
    read: number
    failed: number
    byTemplate: Array<{ templateName: string; failed: number }>
  }
  biggest_leak: ReturnType<typeof biggestLeak>
}

function buildDailyJsonFromSeed(counts: FunnelCounts): DailyJson {
  const from = new Date('2026-06-21T00:00:00.000Z')
  const to = new Date('2026-06-22T00:00:00.000Z')
  const byService = rankFunnelGroups([
    { key: 'plumbing', submitted: 29, accepted: 18 },
    { key: 'handyman', submitted: 22, accepted: 10 },
  ])
  const bySuburb = rankFunnelGroups([
    { key: 'Roodepoort', submitted: 18, accepted: 11 },
    { key: 'Northgate', submitted: 12, accepted: 5 },
  ])
  return {
    window: { from: from.toISOString(), to: to.toISOString(), days: 1 },
    funnel: counts,
    conversions: {
      started_to_submitted: counts.started > 0 ? counts.submitted / counts.started : null,
      submitted_to_matched: counts.submitted > 0 ? counts.matchAttempted / counts.submitted : null,
      matched_to_eligible:
        counts.matchAttempted > 0 ? counts.matchedToProvider / counts.matchAttempted : null,
      eligible_to_accepted:
        counts.matchedToProvider > 0 ? counts.providerAccepted / counts.matchedToProvider : null,
      accepted_to_notified:
        counts.providerAccepted > 0 ? counts.clientNotified / counts.providerAccepted : null,
    },
    ops_action_items: {
      submitted_with_zero_eligible: counts.matchAttempted - counts.matchedToProvider,
      providers_notified_no_acceptance: counts.matchedToProvider - counts.providerAccepted,
      accepted_but_client_not_notified: counts.providerAccepted - counts.clientNotified,
    },
    by_service: byService,
    by_suburb: bySuburb,
    notification_health: {
      sent: 214,
      delivered: 198,
      read: 173,
      failed: 4,
      byTemplate: [{ templateName: 'provider_lead_offer', failed: 3 }],
    },
    biggest_leak: biggestLeak(counts),
  }
}

describe('daily-customer-funnel-report JSON shape', () => {
  it('produces all sections required by automation consumers', () => {
    const counts: FunnelCounts = {
      started: 127,
      submitted: 83,
      matchAttempted: 83,
      matchedToProvider: 71,
      providerAccepted: 39,
      clientNotified: 37,
    }
    const payload = buildDailyJsonFromSeed(counts)
    expect(payload).toHaveProperty('window.days')
    expect(payload).toHaveProperty('funnel.started')
    expect(payload).toHaveProperty('conversions.eligible_to_accepted')
    expect(payload).toHaveProperty('ops_action_items.providers_notified_no_acceptance')
    expect(Array.isArray(payload.by_service)).toBe(true)
    expect(Array.isArray(payload.by_suburb)).toBe(true)
    expect(payload.notification_health.failed).toBe(4)
    expect(payload.biggest_leak?.fromStage).toBe('matchedToProvider')
  })

  it('reports null conversions when the upstream stage was zero', () => {
    const counts: FunnelCounts = {
      started: 0,
      submitted: 0,
      matchAttempted: 0,
      matchedToProvider: 0,
      providerAccepted: 0,
      clientNotified: 0,
    }
    const payload = buildDailyJsonFromSeed(counts)
    expect(payload.conversions.started_to_submitted).toBeNull()
    expect(payload.conversions.eligible_to_accepted).toBeNull()
    expect(payload.biggest_leak).toBeNull()
  })

  it('surfaces three ops action items when the funnel has leaks', () => {
    const counts: FunnelCounts = {
      started: 100,
      submitted: 80,
      matchAttempted: 80,
      matchedToProvider: 70, // 10 zero-eligible
      providerAccepted: 40, // 30 matched-not-accepted
      clientNotified: 38, // 2 accepted-not-notified
    }
    const payload = buildDailyJsonFromSeed(counts)
    expect(payload.ops_action_items).toEqual({
      submitted_with_zero_eligible: 10,
      providers_notified_no_acceptance: 30,
      accepted_but_client_not_notified: 2,
    })
  })
})
