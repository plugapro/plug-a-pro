// ─── Matching Engine Compatibility Layer ─────────────────────────────────────
// Preserves the existing lead-based entry points used by WhatsApp and cron while
// delegating ranking, scheduling, scoring, and fallback orchestration to the
// production matcher domain in ./matching/service.

import { db } from './db'
import { MATCHING_CONFIG } from './matching/config'
import {
  acceptAssignmentOffer,
  processPendingAssignmentWorkflows,
  rejectAssignmentOffer,
  runAssignmentForJobRequest,
} from './matching/service'
import { reconcileProviderRecordsFromApplications } from './provider-record'
import { notifyProviderNewJob } from './whatsapp-bot'

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

type LegacyDispatchJobRequest = {
  id: string
  status: string
  category: string
  title: string
  description: string
  customer: { name: string } | null
  address: { suburb: string | null; city: string | null } | null
}

// TODO: remove once pending migrations (assignment_holds, match_attempts, dispatch_decisions,
// whatsapp_preferences, assurance_second_sweep) are applied to production via `prisma migrate deploy`.
// This guard is re-instated to protect production while the schema gap exists.
// Tracks Prisma errors P2021 (table missing) and P2022 (column missing).
function isSchemaCompatError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? (error as { code?: string }).code : undefined
  return code === 'P2021' || code === 'P2022'
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'Customer'
}

function leadDescription(jobRequest: LegacyDispatchJobRequest) {
  const source = jobRequest.title?.trim() || jobRequest.description?.trim() || `${jobRequest.category} job`
  return source.length > 120 ? `${source.slice(0, 117)}...` : source
}

async function loadLegacyDispatchJobRequest(jobRequestId: string): Promise<LegacyDispatchJobRequest | null> {
  return db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      status: true,
      category: true,
      title: true,
      description: true,
      customer: {
        select: {
          name: true,
        },
      },
      address: {
        select: {
          suburb: true,
          city: true,
        },
      },
    },
  })
}

async function dispatchLeadsLegacy(jobRequestId: string): Promise<DispatchResult> {
  const jobRequest = await loadLegacyDispatchJobRequest(jobRequestId)
  if (!jobRequest || !['OPEN', 'MATCHING'].includes(jobRequest.status)) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  const suburb = jobRequest.address?.suburb ?? ''
  const city = jobRequest.address?.city ?? ''
  const candidates = await findCandidateProviders({
    category: jobRequest.category,
    suburb,
    city,
  })

  if (candidates.length === 0) {
    return {
      jobRequestId,
      leadsDispatched: 0,
      candidatesFound: 0,
      noMatch: true,
    }
  }

  const existingLeads = await db.lead.findMany({
    where: { jobRequestId },
    select: { providerId: true, status: true },
  })
  const contactedProviderIds = new Set(existingLeads.map((lead) => lead.providerId))
  const nextCandidates = candidates.filter((candidate) => !contactedProviderIds.has(candidate.id))

  let leadsDispatched = 0

  for (const candidate of nextCandidates.slice(0, 5)) {
    const lead = await db.lead.create({
      data: {
        jobRequestId,
        providerId: candidate.id,
        status: 'SENT',
        expiresAt: new Date(Date.now() + MATCHING_CONFIG.offerTtlMinutes * 60_000),
      },
      select: {
        id: true,
        expiresAt: true,
      },
    })

    await notifyProviderNewJob({
      providerPhone: candidate.phone,
      leadId: lead.id,
      category: jobRequest.category,
      area: [suburb, city].filter(Boolean).join(', ') || 'Your area',
      description: leadDescription(jobRequest),
      customerInitial: firstName(jobRequest.customer?.name),
      expiresInMinutes: lead.expiresAt
        ? Math.max(1, Math.round((lead.expiresAt.getTime() - Date.now()) / 60_000))
        : MATCHING_CONFIG.offerTtlMinutes,
    })

    leadsDispatched += 1
  }

  if (leadsDispatched > 0) {
    await db.jobRequest.updateMany({
      where: { id: jobRequestId, status: { in: ['OPEN', 'MATCHING'] } },
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

async function acceptLeadLegacy(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
}): Promise<LeadAcceptanceResult> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      jobRequestId: true,
      providerId: true,
      status: true,
    },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (lead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }
  if (lead.status === 'EXPIRED') return { ok: false, reason: 'EXPIRED' }

  const existingMatch = await db.match.findUnique({
    where: { jobRequestId: lead.jobRequestId },
    select: { id: true },
  })
  if (existingMatch) return { ok: false, reason: 'TAKEN' }

  const accepted = await db.lead.updateMany({
    where: {
      id: lead.id,
      providerId: params.providerId,
      status: { in: ['SENT', 'VIEWED'] },
    },
    data: {
      status: 'ACCEPTED',
      respondedAt: new Date(),
    },
  })

  if (accepted.count === 0) {
    const match = await db.match.findUnique({
      where: { jobRequestId: lead.jobRequestId },
      select: { id: true },
    })
    return match ? { ok: false, reason: 'TAKEN' } : { ok: false, reason: 'EXPIRED' }
  }

  try {
    const match = await db.match.create({
      data: {
        jobRequestId: lead.jobRequestId,
        providerId: params.providerId,
        status: 'MATCHED',
        inspectionNeeded: params.inspectionNeeded === true,
      },
      select: { id: true },
    })

    await db.jobRequest.updateMany({
      where: { id: lead.jobRequestId },
      data: { status: 'MATCHED' },
    })

    await db.lead.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.id },
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: {
        status: 'EXPIRED',
        respondedAt: new Date(),
      },
    })

    return {
      ok: true,
      leadId: params.leadId,
      matchId: match.id,
      inspectionNeeded: params.inspectionNeeded === true,
    }
  } catch (error) {
    if (
      error != null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { ok: false, reason: 'TAKEN' }
    }
    throw error
  }
}

async function declineLeadLegacy(params: {
  leadId: string
  providerId: string
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' }> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      providerId: true,
      jobRequestId: true,
    },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (lead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }

  await db.lead.updateMany({
    where: {
      id: lead.id,
      providerId: params.providerId,
      status: { in: ['SENT', 'VIEWED'] },
    },
    data: {
      status: 'DECLINED',
      respondedAt: new Date(),
    },
  })

  await dispatchLeadsLegacy(lead.jobRequestId)

  return { ok: true }
}

async function expireStaleLeadsLegacy() {
  const result = await db.lead.updateMany({
    where: {
      status: { in: ['SENT', 'VIEWED'] },
      expiresAt: { lte: new Date() },
    },
    data: {
      status: 'EXPIRED',
      respondedAt: new Date(),
    },
  })

  return result.count
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
  const providers = await db.provider.findMany({
    where: { active: true },
    select: {
      id: true,
      phone: true,
      availableNow: true,
      skills: true,
      serviceAreas: true,
    },
  })

  const category = input.category.trim().toLowerCase()
  const suburb = input.suburb.trim().toLowerCase()
  const city = input.city.trim().toLowerCase()

  return providers.filter((provider) => {
    const providerSkills = provider.skills.map((skill) => skill.toLowerCase())
    const areas = provider.serviceAreas.map((area) => area.toLowerCase()).filter(Boolean)

    return (
      provider.availableNow &&
      providerSkills.includes(category) &&
      (areas.includes(suburb) || areas.includes(city))
    )
  })
}

export async function dispatchLeads(jobRequestId: string): Promise<DispatchResult> {
  await reconcileProviderRecordsFromApplications(db)

  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: { id: true, status: true },
  })

  if (!jobRequest || !['OPEN', 'MATCHING'].includes(jobRequest.status)) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

  try {
    const result = await runAssignmentForJobRequest({
      jobRequestId,
      actor: { actorId: 'system', actorRole: 'system' },
      mode: 'AUTO_ASSIGN',
    })

    return {
      jobRequestId,
      leadsDispatched: result.assignmentHoldId ? 1 : 0,
      candidatesFound: result.candidates.length,
      noMatch: result.candidates.length === 0,
    }
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error
    console.warn('[matching-engine] assignment_holds schema not yet migrated — using legacy dispatch')
    return dispatchLeadsLegacy(jobRequestId)
  }
}

export async function acceptLead(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
}): Promise<LeadAcceptanceResult> {
  try {
    const result = await acceptAssignmentOffer(params)
    if (!result.ok) return result
    return {
      ok: true,
      leadId: params.leadId,
      matchId: result.matchId ?? '',
      inspectionNeeded: params.inspectionNeeded === true,
    }
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error
    console.warn('[matching-engine] assignment schema not yet migrated — using legacy acceptLead')
    return acceptLeadLegacy(params)
  }
}

export async function declineLead(params: {
  leadId: string
  providerId: string
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' }> {
  try {
    const result = await rejectAssignmentOffer(params)
    if (!result.ok) {
      if (result.reason === 'EXPIRED' || result.reason === 'TAKEN') return { ok: true }
      return { ok: false, reason: result.reason }
    }
    return { ok: true }
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error
    console.warn('[matching-engine] assignment schema not yet migrated — using legacy declineLead')
    return declineLeadLegacy(params)
  }
}

export async function expireStaleLeads(): Promise<number> {
  try {
    const result = await processPendingAssignmentWorkflows()
    return result.expiredOffers
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error
    console.warn('[matching-engine] assignment schema not yet migrated — using legacy expireStaleLeads')
    return expireStaleLeadsLegacy()
  }
}
