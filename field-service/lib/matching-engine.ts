// ─── Matching Engine ──────────────────────────────────────────────────────────
// Finds candidate service providers for a job request, creates Lead records,
// and dispatches WhatsApp notifications.
//
// Matching criteria:
//   1. Skills: provider.skills includes job category (case-insensitive)
//   2. Area: provider.serviceAreas overlaps job suburb or city
//   3. State: provider.active AND provider.availableNow AND provider.verified

import { db } from './db'

const LEAD_EXPIRY_HOURS = 4
const MAX_LEADS_PER_REQUEST = 3
const FAIRNESS_WINDOW_DAYS = 7

function isUniqueLeadError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  )
}

export interface CandidateInput {
  category: string
  suburb: string
  city: string
}

export interface DispatchResult {
  jobRequestId: string
  leadsDispatched: number
  candidatesFound: number
  noMatch: boolean
}

type LeadAccepted = {
  ok: true
  leadId: string
  matchId: string
  inspectionNeeded: boolean
}

type LeadRejected = {
  ok: false
  reason: 'NOT_FOUND' | 'FORBIDDEN' | 'EXPIRED' | 'TAKEN'
}

export type LeadAcceptanceResult = LeadAccepted | LeadRejected

export async function findCandidateProviders(input: CandidateInput) {
  const categoryNorm = input.category.toLowerCase()
  const suburbNorm = input.suburb.toLowerCase()
  const cityNorm = input.city.toLowerCase()
  const areaTerms = [input.suburb, input.city]
    .map((a) => a.toLowerCase())
    .filter(Boolean)

  const providers = await db.provider.findMany({
    where: { active: true, availableNow: true, verified: true },
    select: {
      id: true,
      phone: true,
      name: true,
      skills: true,
      serviceAreas: true,
      availableNow: true,
    },
  })

  const fairnessSince = new Date(Date.now() - FAIRNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const providerIds = providers.map((provider) => provider.id)
  const [recentLeadCounts, recentAcceptedCounts] = providerIds.length
    ? await Promise.all([
        db.lead.groupBy({
          by: ['providerId'],
          where: {
            providerId: { in: providerIds },
            sentAt: { gte: fairnessSince },
          },
          _count: { _all: true },
        }),
        db.lead.groupBy({
          by: ['providerId'],
          where: {
            providerId: { in: providerIds },
            status: 'ACCEPTED',
            respondedAt: { gte: fairnessSince },
          },
          _count: { _all: true },
        }),
      ])
    : [[], []]

  const leadCountByProvider = new Map(
    recentLeadCounts.map((row) => [row.providerId, row._count._all])
  )
  const acceptedCountByProvider = new Map(
    recentAcceptedCounts.map((row) => [row.providerId, row._count._all])
  )

  return providers
    .map((p) => {
      const hasSkill = p.skills.some((s) => s.toLowerCase() === categoryNorm)
      if (!hasSkill) return null

      let bestAreaScore = -1
      for (const area of p.serviceAreas) {
        const aNorm = area.toLowerCase()
        if (suburbNorm && aNorm === suburbNorm) bestAreaScore = Math.max(bestAreaScore, 3)
        else if (cityNorm && aNorm === cityNorm) bestAreaScore = Math.max(bestAreaScore, 2)
        else if (areaTerms.some((term) => aNorm.includes(term) || term.includes(aNorm))) {
          bestAreaScore = Math.max(bestAreaScore, 1)
        }
      }

      if (bestAreaScore < 0) return null
      return {
        provider: p,
        score: bestAreaScore,
        recentLeadCount: leadCountByProvider.get(p.id) ?? 0,
        recentAcceptedCount: acceptedCountByProvider.get(p.id) ?? 0,
      }
    })
    .filter(
      (
        entry
      ): entry is {
        provider: (typeof providers)[number]
        score: number
        recentLeadCount: number
        recentAcceptedCount: number
      } => entry !== null
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.recentLeadCount - b.recentLeadCount ||
        a.recentAcceptedCount - b.recentAcceptedCount ||
        a.provider.name.localeCompare(b.provider.name)
    )
    .map((entry) => entry.provider)
}

export async function dispatchLeads(jobRequestId: string): Promise<DispatchResult> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    include: {
      address: true,
      customer: { select: { name: true } },
    },
  })

  if (!jobRequest) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  if (!['OPEN', 'MATCHING'].includes(jobRequest.status)) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  const candidates = await findCandidateProviders({
    category: jobRequest.category,
    suburb: jobRequest.address?.suburb ?? '',
    city: jobRequest.address?.city ?? '',
  })

  if (candidates.length === 0) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  const expiresAt = new Date(Date.now() + LEAD_EXPIRY_HOURS * 60 * 60 * 1000)
  let leadsDispatched = 0

  for (const provider of candidates) {
    if (leadsDispatched >= MAX_LEADS_PER_REQUEST) break

    // Stop dispatching if another provider has already accepted the request.
    const existingMatch = await db.match.findUnique({ where: { jobRequestId } })
    if (existingMatch) break

    // Idempotency: skip if an active lead already exists for this job+provider.
    // If the provider previously declined or the lead expired, reuse the same
    // row instead of creating a duplicate because the schema keeps one lead row
    // per job/provider pair.
    const existing = await db.lead.findFirst({
      where: {
        jobRequestId,
        providerId: provider.id,
      },
    })
    if (existing?.status && ['SENT', 'VIEWED', 'ACCEPTED'].includes(existing.status)) continue

    let lead
    try {
      lead = existing
        ? await db.lead.update({
            where: { id: existing.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
              respondedAt: null,
              expiresAt,
            },
          })
        : await db.lead.create({
            data: { jobRequestId, providerId: provider.id, status: 'SENT', expiresAt },
          })
    } catch (error) {
      if (isUniqueLeadError(error)) continue
      throw error
    }

    const description =
      jobRequest.title || (jobRequest.description ?? '').slice(0, 60) || jobRequest.category
    const customerFirst = (jobRequest.customer?.name ?? '').split(' ')[0] ?? 'Customer'

    // Lazy import to avoid circular dependency
    const { notifyProviderNewJob } = await import('./whatsapp-bot')
    await notifyProviderNewJob({
      providerPhone: provider.phone,
      leadId: lead.id,
      category: jobRequest.category,
      area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
      description,
      customerInitial: customerFirst,
    }).catch((err: unknown) => {
      console.error(`[matching-engine] WA notify failed for provider ${provider.id}:`, err)
    })

    leadsDispatched++
  }

  if (leadsDispatched > 0 && jobRequest.status !== 'MATCHING') {
    await db.jobRequest.update({
      where: { id: jobRequestId },
      data: { status: 'MATCHING' },
    })
  }

  return {
    jobRequestId,
    leadsDispatched,
    candidatesFound: candidates.length,
    noMatch: leadsDispatched === 0,
  }
}

export async function acceptLead(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
}): Promise<LeadAcceptanceResult> {
  try {
    return await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: params.leadId },
        include: {
          jobRequest: { select: { id: true, status: true } },
        },
      })

      if (!lead) return { ok: false as const, reason: 'NOT_FOUND' }
      if (lead.providerId !== params.providerId) return { ok: false as const, reason: 'FORBIDDEN' }
      if (!['SENT', 'VIEWED', 'ACCEPTED'].includes(lead.status)) {
        return { ok: false as const, reason: 'TAKEN' }
      }
      if (lead.expiresAt && lead.expiresAt < new Date()) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'EXPIRED', respondedAt: new Date() },
        })
        return { ok: false as const, reason: 'EXPIRED' }
      }

      const existingMatch = await tx.match.findUnique({
        where: { jobRequestId: lead.jobRequestId },
      })

      if (existingMatch) {
        if (existingMatch.providerId === params.providerId) {
          await tx.lead.updateMany({
            where: { id: lead.id, status: { in: ['SENT', 'VIEWED'] } },
            data: { status: 'ACCEPTED', respondedAt: new Date() },
          })
          return {
            ok: true as const,
            leadId: lead.id,
            matchId: existingMatch.id,
            inspectionNeeded: existingMatch.inspectionNeeded,
          }
        }

        await tx.lead.updateMany({
          where: { id: lead.id, status: { in: ['SENT', 'VIEWED'] } },
          data: { status: 'EXPIRED', respondedAt: new Date() },
        })
        return { ok: false as const, reason: 'TAKEN' }
      }

      const inspectionNeeded = params.inspectionNeeded === true

      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      })

      const match = await tx.match.create({
        data: {
          jobRequestId: lead.jobRequestId,
          providerId: params.providerId,
          status: inspectionNeeded ? 'INSPECTION_SCHEDULED' : 'MATCHED',
          inspectionNeeded,
        },
      })

      await tx.jobRequest.update({
        where: { id: lead.jobRequestId },
        data: { status: 'MATCHED' },
      })

      await tx.lead.updateMany({
        where: {
          jobRequestId: lead.jobRequestId,
          id: { not: lead.id },
          status: { in: ['SENT', 'VIEWED'] },
        },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      })

      return {
        ok: true as const,
        leadId: lead.id,
        matchId: match.id,
        inspectionNeeded,
      }
    })
  } catch {
    return { ok: false as const, reason: 'TAKEN' }
  }
}

export async function declineLead(params: {
  leadId: string
  providerId: string
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' }> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: { id: true, providerId: true, jobRequestId: true, status: true },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (lead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }
  if (!['SENT', 'VIEWED'].includes(lead.status)) {
    return { ok: true }
  }

  await db.lead.updateMany({
    where: { id: lead.id, status: { in: ['SENT', 'VIEWED'] } },
    data: { status: 'DECLINED', respondedAt: new Date() },
  })

  const [activeLeadCount, match] = await Promise.all([
    db.lead.count({
      where: {
        jobRequestId: lead.jobRequestId,
        status: { in: ['SENT', 'VIEWED', 'ACCEPTED'] },
      },
    }),
    db.match.findUnique({ where: { jobRequestId: lead.jobRequestId } }),
  ])

  if (!match && activeLeadCount === 0) {
    await db.jobRequest.update({
      where: { id: lead.jobRequestId },
      data: { status: 'OPEN' },
    })
  }

  return { ok: true }
}

export async function expireStaleLeads(): Promise<number> {
  const staleLeads = await db.lead.findMany({
    where: { status: { in: ['SENT', 'VIEWED'] }, expiresAt: { lt: new Date() } },
  })

  let expired = 0
  for (const lead of staleLeads) {
    await db.lead.update({
      where: { id: lead.id },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })

    const [activeLeadCount, match] = await Promise.all([
      db.lead.count({
        where: {
          jobRequestId: lead.jobRequestId,
          status: { in: ['SENT', 'VIEWED', 'ACCEPTED'] },
        },
      }),
      db.match.findUnique({ where: { jobRequestId: lead.jobRequestId } }),
    ])

    if (!match && activeLeadCount === 0) {
      await db.jobRequest.update({
        where: { id: lead.jobRequestId },
        data: { status: 'OPEN' },
      })
    }
    expired++
  }

  return expired
}
