import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { provider: { findMany: vi.fn() } },
}))

import { db } from '@/lib/db'
import {
  loadProfileCandidates,
  DRAFT_BUDGET_PER_RUN,
} from '@/lib/ops-agents/agents/profile-coach/loader'

const dbAny = db as unknown as { provider: { findMany: ReturnType<typeof vi.fn> } }

// A provider with `present` of the 7 completeness fields filled (rest empty).
function provider(id: string, present: number, opts: { optIn?: boolean; phone?: boolean } = {}) {
  const has = (n: number) => present > n
  return {
    id,
    phone: opts.phone === false ? null : '+2760000' + id,
    firstName: 'P' + id,
    bio: has(0) ? 'bio' : null,
    avatarUrl: has(1) ? 'a' : null,
    experience: has(2) ? 'exp' : null,
    portfolioUrls: has(3) ? ['u'] : [],
    skills: has(4) ? ['plumbing'] : [],
    serviceAreas: has(5) ? ['Honeydew'] : [],
    equipmentTags: has(6) ? ['ladder'] : [],
    verified: false,
    kycStatus: 'NOT_STARTED',
    payoutVerifiedAt: null,
    averageRating: 0,
    completedJobsCount: 0,
    reliabilityScore: 0.5,
    acceptanceRate: 1,
    complaintRate: 0,
    whatsappMarketingOptIn: opts.optIn ?? true,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('loadProfileCandidates — draft budget cap', () => {
  it('marks at most DRAFT_BUDGET_PER_RUN providers draft-eligible', async () => {
    // 40 reachable, opted-in providers with varying completeness
    const rows = Array.from({ length: 40 }, (_, i) => provider(String(i), i % 7))
    dbAny.provider.findMany.mockResolvedValue(rows)

    const candidates = await loadProfileCandidates({ nowIso: '2026-06-22T06:00:00.000Z' })
    const eligible = candidates.filter((c) => c.draftEligible)

    expect(candidates).toHaveLength(40)
    expect(eligible.length).toBe(DRAFT_BUDGET_PER_RUN)
  })

  it('prioritises the least-complete providers for the draft budget', async () => {
    const rows = [
      provider('full', 7), // most complete — should NOT be eligible
      provider('empty', 0), // least complete — should be eligible
      provider('mid', 4),
    ]
    dbAny.provider.findMany.mockResolvedValue(rows)

    const candidates = await loadProfileCandidates({ nowIso: '2026-06-22T06:00:00.000Z' })
    const byId = Object.fromEntries(candidates.map((c) => [c.id, c.draftEligible]))

    // budget (25) > 3 here, but the least-complete must be eligible regardless
    expect(byId['empty']).toBe(true)
  })

  it('never marks unreachable or opted-out providers draft-eligible', async () => {
    const rows = [
      provider('optout', 0, { optIn: false }),
      provider('nophone', 0, { phone: false }),
    ]
    dbAny.provider.findMany.mockResolvedValue(rows)

    const candidates = await loadProfileCandidates({ nowIso: '2026-06-22T06:00:00.000Z' })
    expect(candidates.every((c) => c.draftEligible === false)).toBe(true)
  })
})
