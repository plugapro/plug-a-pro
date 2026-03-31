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

export async function findCandidateProviders(input: CandidateInput) {
  const categoryNorm = input.category.toLowerCase()
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

  return providers.filter((p) => {
    const hasSkill = p.skills.some((s) => s.toLowerCase() === categoryNorm)
    const inArea = p.serviceAreas.some((a) => {
      const aNorm = a.toLowerCase()
      return areaTerms.some((term) => aNorm.includes(term) || term.includes(aNorm))
    })
    return hasSkill && inArea
  })
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
    // Idempotency: skip if lead already exists
    const existing = await db.lead.findFirst({
      where: { jobRequestId, providerId: provider.id },
    })
    if (existing) continue

    // Skip if already matched to someone else
    const existingMatch = await db.match.findFirst({ where: { jobRequestId } })
    if (existingMatch) continue

    await db.lead.create({
      data: { jobRequestId, providerId: provider.id, status: 'SENT', expiresAt },
    })

    const match = await db.match.create({
      data: { jobRequestId, providerId: provider.id, status: 'MATCHED' },
    })

    const description =
      jobRequest.title || (jobRequest.description ?? '').slice(0, 60) || jobRequest.category
    const customerFirst = (jobRequest.customer?.name ?? '').split(' ')[0] ?? 'Customer'

    // Lazy import to avoid circular dependency
    const { notifyProviderNewJob } = await import('./whatsapp-bot')
    await notifyProviderNewJob({
      providerPhone: provider.phone,
      matchId: match.id,
      category: jobRequest.category,
      area: jobRequest.address?.suburb ?? jobRequest.address?.city ?? '',
      description,
      customerInitial: customerFirst,
    }).catch((err: unknown) => {
      console.error(`[matching-engine] WA notify failed for provider ${provider.id}:`, err)
    })

    leadsDispatched++
    break // Dispatch to first available candidate only — cron handles retry
  }

  return {
    jobRequestId,
    leadsDispatched,
    candidatesFound: candidates.length,
    noMatch: leadsDispatched === 0,
  }
}

export async function expireStaleLeads(): Promise<number> {
  const staleLeads = await db.lead.findMany({
    where: { status: 'SENT', expiresAt: { lt: new Date() } },
  })

  let expired = 0
  for (const lead of staleLeads) {
    await db.lead.update({ where: { id: lead.id }, data: { status: 'EXPIRED' } })
    await db.match
      .deleteMany({
        where: { jobRequestId: lead.jobRequestId, providerId: lead.providerId, status: 'MATCHED' },
      })
      .catch(() => {})
    expired++
  }

  return expired
}
