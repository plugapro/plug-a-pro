// ─── Matching Journey Monitor Agent — loader ─────────────────────────────────

import { db } from '@/lib/db'
import { areaInPilot } from '../../pilot-area'
import type { MatchingCandidate } from './evaluator'

const ACTIVE_STATUSES = [
  'PENDING_VALIDATION',
  'OPEN',
  'MATCHING',
  'SHORTLIST_READY',
  'PROVIDER_CONFIRMATION_PENDING',
  'MATCHED',
] as const

const PENDING_LEAD_STATUSES = ['SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED'] as const

export interface LoadArgs {
  nowIso: string
  windowFromIso?: string | null
  windowToIso?: string | null
}

export async function loadMatchingCandidates(_args: LoadArgs): Promise<MatchingCandidate[]> {
  const requests = await db.jobRequest.findMany({
    where: {
      isTestRequest: false,
      status: { in: [...ACTIVE_STATUSES] },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      address: { select: { locationNode: { select: { slug: true } } } },
      leads: { select: { status: true, sentAt: true } },
      match: {
        select: {
          createdAt: true,
          providerOnTheWayAt: true,
          providerArrivedAt: true,
          providerStartedAt: true,
          providerCompletedAt: true,
          booking: { select: { id: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  })

  return requests.map((r): MatchingCandidate => {
    const declineCount = r.leads.filter((l) => l.status === 'DECLINED' || l.status === 'EXPIRED').length
    const pending = r.leads.filter((l) => (PENDING_LEAD_STATUSES as readonly string[]).includes(l.status))
    const oldestPending = pending.reduce<Date | null>(
      (min, l) => (min === null || l.sentAt < min ? l.sentAt : min),
      null,
    )
    const m = r.match
    const matchProgressed = Boolean(
      m &&
        (m.providerOnTheWayAt ||
          m.providerArrivedAt ||
          m.providerStartedAt ||
          m.providerCompletedAt ||
          m.booking),
    )
    const slug = r.address?.locationNode?.slug ?? null
    return {
      id: r.id,
      status: r.status,
      createdAtIso: r.createdAt.toISOString(),
      updatedAtIso: r.updatedAt.toISOString(),
      leadsCount: r.leads.length,
      pendingLeadsCount: pending.length,
      declineCount,
      oldestPendingLeadIso: oldestPending ? oldestPending.toISOString() : null,
      hasMatch: Boolean(m),
      matchProgressed,
      matchCreatedAtIso: m ? m.createdAt.toISOString() : null,
      inPilotArea: slug ? areaInPilot(slug) : null,
    }
  })
}
