// Admin Tier 1 funnel reporting — data layer for /admin/reports/funnel.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// Read-only aggregations. Returns counts + category/suburb labels only — no
// customer names, phones, addresses, or request descriptions. Per-request
// drill-down lives in Tier 3.

import type { PrismaClient, Prisma } from '@prisma/client'
import { db as defaultDb } from '@/lib/db'

export interface FunnelRange {
  from: Date
  /** Exclusive end — typical convention. */
  to: Date
}

export interface FunnelCounts {
  started: number
  submitted: number
  matchAttempted: number
  matchedToProvider: number
  providerAccepted: number
  clientNotified: number
}

export interface FunnelByGroupRow {
  key: string
  submitted: number
  accepted: number
  conversionRate: number
}

export interface NotificationHealth {
  sent: number
  delivered: number
  read: number
  failed: number
  byTemplate: Array<{ templateName: string; failed: number }>
}

type PrismaLike = PrismaClient | Prisma.TransactionClient

// Pure rate calculator — exported for unit tests so the rounding behaviour is
// covered without a database. Returns a 0-1 ratio. Divide-by-zero → 0.
export function conversionRate(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return numerator / denominator
}

// Pure ranker — turns a {key, submitted, accepted} bag into a sorted, rate-
// annotated table. Stable order: highest submitted first, then alphabetical key
// for ties so snapshot tests are deterministic.
export function rankFunnelGroups(
  rows: Array<{ key: string; submitted: number; accepted: number }>,
  limit?: number,
): FunnelByGroupRow[] {
  const annotated = rows.map((r) => ({
    key: r.key,
    submitted: r.submitted,
    accepted: r.accepted,
    conversionRate: conversionRate(r.accepted, r.submitted),
  }))
  annotated.sort((a, b) => {
    if (b.submitted !== a.submitted) return b.submitted - a.submitted
    return a.key.localeCompare(b.key)
  })
  return typeof limit === 'number' ? annotated.slice(0, limit) : annotated
}

// Helper to keep the page's leak-detection logic in one place.
export function biggestLeak(counts: FunnelCounts): {
  fromStage: keyof FunnelCounts
  toStage: keyof FunnelCounts
  dropped: number
  ratio: number
} | null {
  const stages: Array<keyof FunnelCounts> = [
    'started',
    'submitted',
    'matchAttempted',
    'matchedToProvider',
    'providerAccepted',
    'clientNotified',
  ]
  let worst: ReturnType<typeof biggestLeak> = null
  for (let i = 1; i < stages.length; i++) {
    const fromStage = stages[i - 1]
    const toStage = stages[i]
    const dropped = counts[fromStage] - counts[toStage]
    if (dropped <= 0) continue
    const ratio = counts[fromStage] === 0 ? 0 : dropped / counts[fromStage]
    // Rank by drop ratio (proportion lost), not absolute count — this matches
    // how operators read funnel charts and the spec's sample output.
    if (!worst || ratio > worst.ratio) {
      worst = { fromStage, toStage, dropped, ratio }
    }
  }
  return worst
}

const LEAD_NOTIFICATION_TEMPLATES = [
  'quick_match_provider_lead_offer',
  'provider_lead_offer',
  'provider_rfp_lead_invite',
  'dispatch:job_lead_actions',
] as const

// ─── Fetchers (call the page or the daily script) ────────────────────────────

export async function fetchFunnelCounts(
  range: FunnelRange,
  client: PrismaLike = defaultDb,
): Promise<FunnelCounts> {
  const occurredFilter = { occurredAt: { gte: range.from, lt: range.to } }
  const submittedFilter = { submittedAt: { gte: range.from, lt: range.to }, isTestRequest: false }
  const dispatchFilter = { createdAt: { gte: range.from, lt: range.to } }

  const [started, submitted, matchAttempted, matchedToProvider, providerAccepted, clientNotified] =
    await Promise.all([
      client.workflowEvent.count({ where: { eventType: 'REQUEST_STARTED', ...occurredFilter } }),
      client.jobRequest.count({ where: submittedFilter }),
      client.dispatchDecision.count({ where: dispatchFilter }),
      client.dispatchDecision.count({ where: { ...dispatchFilter, eligibleCount: { gt: 0 } } }),
      client.workflowEvent.count({ where: { eventType: 'PROVIDER_ACCEPTED', ...occurredFilter } }),
      client.workflowEvent.count({ where: { eventType: 'CLIENT_NOTIFIED', ...occurredFilter } }),
    ])

  return { started, submitted, matchAttempted, matchedToProvider, providerAccepted, clientNotified }
}

// Joins JobRequest.category (submission count) to Lead → JobRequest → category
// (accepted count) via the PROVIDER_ACCEPTED WorkflowEvent stream.
export async function fetchFunnelByService(
  range: FunnelRange,
  client: PrismaLike = defaultDb,
  limit = 20,
): Promise<FunnelByGroupRow[]> {
  const submittedRows = await client.jobRequest.groupBy({
    by: ['category'],
    where: { submittedAt: { gte: range.from, lt: range.to }, isTestRequest: false },
    _count: { _all: true },
  })

  // Accepted: WorkflowEvent.entityId === Lead.id; join to Lead → JobRequest → category.
  const acceptedEvents = await client.workflowEvent.findMany({
    where: {
      eventType: 'PROVIDER_ACCEPTED',
      occurredAt: { gte: range.from, lt: range.to },
    },
    select: { entityId: true },
  })
  const leadIds = acceptedEvents.map((e) => e.entityId)
  const acceptedByCategory = new Map<string, number>()
  if (leadIds.length > 0) {
    const leads = await client.lead.findMany({
      where: { id: { in: leadIds } },
      select: { jobRequest: { select: { category: true, isTestRequest: true } } },
    })
    for (const lead of leads) {
      if (lead.jobRequest?.isTestRequest) continue
      const category = lead.jobRequest?.category
      if (!category) continue
      acceptedByCategory.set(category, (acceptedByCategory.get(category) ?? 0) + 1)
    }
  }

  const merged = submittedRows.map((r) => ({
    key: r.category,
    submitted: r._count._all,
    accepted: acceptedByCategory.get(r.category) ?? 0,
  }))
  return rankFunnelGroups(merged, limit)
}

// Suburb rollup: groups by Address.suburb (raw string today; LocationNode
// normalisation is deferred to Tier 2).
export async function fetchFunnelBySuburb(
  range: FunnelRange,
  client: PrismaLike = defaultDb,
  limit = 20,
): Promise<FunnelByGroupRow[]> {
  const submittedJobs = await client.jobRequest.findMany({
    where: { submittedAt: { gte: range.from, lt: range.to }, isTestRequest: false },
    select: { id: true, address: { select: { suburb: true } } },
  })
  const submittedBySuburb = new Map<string, number>()
  for (const jr of submittedJobs) {
    const suburb = jr.address?.suburb?.trim() || 'Unknown'
    submittedBySuburb.set(suburb, (submittedBySuburb.get(suburb) ?? 0) + 1)
  }

  const acceptedEvents = await client.workflowEvent.findMany({
    where: {
      eventType: 'PROVIDER_ACCEPTED',
      occurredAt: { gte: range.from, lt: range.to },
    },
    select: { entityId: true },
  })
  const acceptedLeadIds = acceptedEvents.map((e) => e.entityId)
  const acceptedBySuburb = new Map<string, number>()
  if (acceptedLeadIds.length > 0) {
    const leads = await client.lead.findMany({
      where: { id: { in: acceptedLeadIds } },
      select: {
        jobRequest: {
          select: {
            isTestRequest: true,
            address: { select: { suburb: true } },
          },
        },
      },
    })
    for (const lead of leads) {
      if (lead.jobRequest?.isTestRequest) continue
      const suburb = lead.jobRequest?.address?.suburb?.trim() || 'Unknown'
      acceptedBySuburb.set(suburb, (acceptedBySuburb.get(suburb) ?? 0) + 1)
    }
  }

  const merged = Array.from(submittedBySuburb.entries()).map(([suburb, submitted]) => ({
    key: suburb,
    submitted,
    accepted: acceptedBySuburb.get(suburb) ?? 0,
  }))
  return rankFunnelGroups(merged, limit)
}

export async function fetchNotificationHealth(
  range: FunnelRange,
  client: PrismaLike = defaultDb,
): Promise<NotificationHealth> {
  const messages = await client.messageEvent.findMany({
    where: {
      templateName: { in: Array.from(LEAD_NOTIFICATION_TEMPLATES) },
      sentAt: { gte: range.from, lt: range.to },
    },
    select: { status: true, templateName: true },
  })

  let sent = 0
  let delivered = 0
  let read = 0
  let failed = 0
  const failedByTemplate = new Map<string, number>()

  for (const m of messages) {
    switch (m.status) {
      case 'SENT':
        sent += 1
        break
      case 'DELIVERED':
        delivered += 1
        break
      case 'READ':
        read += 1
        break
      case 'FAILED':
        failed += 1
        if (m.templateName) {
          failedByTemplate.set(m.templateName, (failedByTemplate.get(m.templateName) ?? 0) + 1)
        }
        break
      default:
        // QUEUED rows aren't counted in delivery health (not yet attempted).
        break
    }
  }

  const byTemplate = Array.from(failedByTemplate.entries())
    .map(([templateName, count]) => ({ templateName, failed: count }))
    .sort((a, b) => b.failed - a.failed)

  return { sent, delivered, read, failed, byTemplate }
}
