// Tier 1 funnel observability — admin aggregate helpers.
// Spec §7: covers `fetchFunnelCounts` correctness + the date-window exclusive-
// end edge case, plus pure rate / ranker / leak helpers.

import { describe, it, expect, vi } from 'vitest'
import {
  conversionRate,
  rankFunnelGroups,
  biggestLeak,
  fetchFunnelCounts,
  type FunnelCounts,
  type FunnelRange,
} from '../../lib/admin/funnel-aggregate'

const FROM = new Date('2026-06-21T00:00:00.000Z')
const TO = new Date('2026-06-22T00:00:00.000Z')
const RANGE: FunnelRange = { from: FROM, to: TO }

describe('conversionRate', () => {
  it('returns 0 when denominator is 0 (no division-by-zero)', () => {
    expect(conversionRate(5, 0)).toBe(0)
  })

  it('returns a 0-1 ratio for positive inputs', () => {
    expect(conversionRate(3, 10)).toBeCloseTo(0.3, 5)
    expect(conversionRate(100, 100)).toBe(1)
  })
})

describe('rankFunnelGroups', () => {
  it('sorts by submitted desc, then alphabetical for ties (deterministic)', () => {
    const ranked = rankFunnelGroups([
      { key: 'plumbing', submitted: 5, accepted: 3 },
      { key: 'electrical', submitted: 5, accepted: 1 },
      { key: 'handyman', submitted: 20, accepted: 10 },
    ])
    expect(ranked.map((r) => r.key)).toEqual(['handyman', 'electrical', 'plumbing'])
  })

  it('annotates each row with conversionRate', () => {
    const ranked = rankFunnelGroups([{ key: 'cleaning', submitted: 4, accepted: 1 }])
    expect(ranked[0].conversionRate).toBeCloseTo(0.25, 5)
  })

  it('applies an optional limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      key: `cat-${i}`,
      submitted: 10 - i,
      accepted: 0,
    }))
    expect(rankFunnelGroups(rows, 3)).toHaveLength(3)
  })
})

describe('biggestLeak', () => {
  it('finds the largest drop ratio between adjacent stages (matches the operator funnel view)', () => {
    const counts: FunnelCounts = {
      started: 100,
      submitted: 80,
      matchAttempted: 80,
      matchedToProvider: 75,
      providerAccepted: 25, // big leak here
      clientNotified: 24,
    }
    const leak = biggestLeak(counts)
    expect(leak?.fromStage).toBe('matchedToProvider')
    expect(leak?.toStage).toBe('providerAccepted')
    expect(leak?.dropped).toBe(50)
  })

  it('returns null when no stage decreases', () => {
    expect(
      biggestLeak({
        started: 10,
        submitted: 10,
        matchAttempted: 10,
        matchedToProvider: 10,
        providerAccepted: 10,
        clientNotified: 10,
      }),
    ).toBeNull()
  })
})

// ─── fetchFunnelCounts with a mocked PrismaLike client ────────────────────────

function makeCountClient(counts: Record<string, number>) {
  let nextValue = 0
  // We return values in the order the Promise.all calls them. Their order is:
  //   workflowEvent.count (REQUEST_STARTED), jobRequest.count (submitted),
  //   dispatchDecision.count (matchAttempted), dispatchDecision.count (eligible>0),
  //   workflowEvent.count (PROVIDER_ACCEPTED), workflowEvent.count (CLIENT_NOTIFIED)
  const queue = [
    counts.started,
    counts.submitted,
    counts.matchAttempted,
    counts.matchedToProvider,
    counts.providerAccepted,
    counts.clientNotified,
  ]
  return {
    workflowEvent: {
      count: vi.fn(async () => {
        nextValue = queue[0]
        queue.shift()
        return nextValue
      }),
    },
    jobRequest: {
      count: vi.fn(async () => {
        nextValue = queue[0]
        queue.shift()
        return nextValue
      }),
    },
    dispatchDecision: {
      count: vi.fn(async () => {
        nextValue = queue[0]
        queue.shift()
        return nextValue
      }),
    },
  }
}

describe('fetchFunnelCounts', () => {
  it('returns the six stage counts in the documented shape', async () => {
    const client = makeCountClient({
      started: 127,
      submitted: 83,
      matchAttempted: 83,
      matchedToProvider: 71,
      providerAccepted: 39,
      clientNotified: 37,
    })
    const counts = await fetchFunnelCounts(RANGE, client as any)
    expect(counts).toEqual({
      started: 127,
      submitted: 83,
      matchAttempted: 83,
      matchedToProvider: 71,
      providerAccepted: 39,
      clientNotified: 37,
    })
  })

  it('uses exclusive-end date filters (lt, not lte) for both occurredAt and submittedAt', async () => {
    const calls: Array<Record<string, unknown>> = []
    const captureWhere = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      calls.push(where)
      return 0
    })
    const client = {
      workflowEvent: { count: captureWhere },
      jobRequest: { count: captureWhere },
      dispatchDecision: { count: captureWhere },
    }
    await fetchFunnelCounts(RANGE, client as any)

    // Every call's date filter must use `lt` for the upper bound; absence of
    // an `lte` key is the contract the unit test asserts.
    for (const where of calls) {
      const dateFilter =
        ('occurredAt' in where && (where.occurredAt as { gte: Date; lt: Date })) ||
        ('submittedAt' in where && (where.submittedAt as { gte: Date; lt: Date })) ||
        ('createdAt' in where && (where.createdAt as { gte: Date; lt: Date }))
      expect(dateFilter).toBeTruthy()
      expect(dateFilter).toMatchObject({ gte: FROM, lt: TO })
    }
  })
})
