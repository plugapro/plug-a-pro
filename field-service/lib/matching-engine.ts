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
import { notifyProviderNewJob } from './whatsapp-bot'

export interface CandidateInput {
  category: string
  suburb: string
  city: string
  regionKey?: string | null
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
  address: {
    suburb: string | null
    city: string | null
    locationNode: { regionKey: string | null } | null
  } | null
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
          locationNode: {
            select: {
              regionKey: true,
            },
          },
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
    regionKey: jobRequest.address?.locationNode?.regionKey ?? null,
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

  try {
    return await db.$transaction(async (tx) => {
      const existingMatch = await tx.match.findUnique({
        where: { jobRequestId: lead.jobRequestId },
        select: { id: true },
      })
      if (existingMatch) return { ok: false as const, reason: 'TAKEN' as const }

      const accepted = await tx.lead.updateMany({
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
        const match = await tx.match.findUnique({
          where: { jobRequestId: lead.jobRequestId },
          select: { id: true },
        })
        return match
          ? { ok: false as const, reason: 'TAKEN' as const }
          : { ok: false as const, reason: 'EXPIRED' as const }
      }

      const match = await tx.match.create({
        data: {
          jobRequestId: lead.jobRequestId,
          providerId: params.providerId,
          status: 'MATCHED',
          inspectionNeeded: params.inspectionNeeded === true,
        },
        select: { id: true },
      })

      await tx.jobRequest.updateMany({
        where: { id: lead.jobRequestId },
        data: { status: 'MATCHED' },
      })

      await tx.lead.updateMany({
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
        ok: true as const,
        leadId: params.leadId,
        matchId: match.id,
        inspectionNeeded: params.inspectionNeeded === true,
      }
    })
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
    where: { active: true, verified: true },
    select: {
      id: true,
      phone: true,
      availableNow: true,
      skills: true,
      serviceAreas: true,
      technicianSkills: {
        where: { active: true },
        select: { skillTag: true },
      },
      technicianServiceAreas: {
        where: { active: true },
        select: {
          areaType: true,
          label: true,
          city: true,
          locationNodeId: true,
          regionKey: true,
          suburbKey: true,
        },
      },
    },
  })

  const category = input.category.trim().toLowerCase()
  const suburb = input.suburb.trim().toLowerCase()
  const city = input.city.trim().toLowerCase()

  return providers.filter((provider) => {
    const providerSkills = new Set(
      [...provider.skills, ...(provider.technicianSkills ?? []).map((skill) => skill.skillTag)].map((skill) =>
        skill.toLowerCase(),
      ),
    )
    if (!provider.availableNow) return false
    if (!providerSkills.has(category)) return false

    const activeStructuredAreas = provider.technicianServiceAreas
    const hasStructuredAreas = activeStructuredAreas.length > 0

    if (hasStructuredAreas) {
      // Structured match: check suburbKey or regionKey (SUBURB_EXACT or REGION_FALLBACK)
      const normalizedSuburb = suburb.replace(/\s+/g, '_').trim()
      const suburbExact = activeStructuredAreas.some((a) => a.suburbKey === normalizedSuburb)
      const regionMatch = input.regionKey != null
        ? activeStructuredAreas.some((a) => a.regionKey === input.regionKey)
        : false
      return suburbExact || regionMatch
    }

    // Legacy string fallback (migration window only)
    if (!MATCHING_CONFIG.allowLegacyStringFallback) return false
    const areas = provider.serviceAreas.map((area) => area.toLowerCase()).filter(Boolean)
    return areas.includes(suburb) || areas.includes(city)
  })
}

export async function dispatchLeads(jobRequestId: string): Promise<DispatchResult> {
  const jobRequest = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: { id: true, status: true },
  })

  if (!jobRequest || !['OPEN', 'MATCHING'].includes(jobRequest.status)) {
    return { jobRequestId, leadsDispatched: 0, candidatesFound: 0, noMatch: true }
  }

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
}

export async function acceptLead(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
}): Promise<LeadAcceptanceResult> {
  const result = await acceptAssignmentOffer(params)
  if (!result.ok) return result
  return {
    ok: true,
    leadId: params.leadId,
    matchId: result.matchId ?? '',
    inspectionNeeded: params.inspectionNeeded === true,
  }
}

export async function declineLead(params: {
  leadId: string
  providerId: string
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' }> {
  const result = await rejectAssignmentOffer(params)
  if (!result.ok) {
    if (result.reason === 'EXPIRED' || result.reason === 'TAKEN') return { ok: true }
    return { ok: false, reason: result.reason }
  }
  return { ok: true }
}

export async function expireStaleLeads(): Promise<number> {
  const result = await processPendingAssignmentWorkflows()
  return result.expiredOffers
}

// ─── Lead reminder: 1-hour nudge for SENT/VIEWED leads with no response ───────

export async function sendLeadReminders(): Promise<number> {
  // Send reminder at ~10 minutes — halfway through the 15-minute offer TTL.
  // (The old 1-hour threshold was dead code: v2 offers expire in 15 minutes.)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)

  const pendingLeads = await db.lead.findMany({
    where: {
      status: { in: ['SENT', 'VIEWED'] },
      sentAt: { lte: tenMinutesAgo },
      reminderSentAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      providerId: true,
      expiresAt: true,
      provider: { select: { phone: true } },
      jobRequest: { select: { category: true, address: { select: { suburb: true, city: true } } } },
    },
    take: 50,
  })

  let sent = 0

  for (const lead of pendingLeads) {
    const area = lead.jobRequest.address
      ? [lead.jobRequest.address.suburb, lead.jobRequest.address.city].filter(Boolean).join(', ')
      : 'your area'
    const ref = lead.id.slice(-8).toUpperCase()
    const minutesLeft = lead.expiresAt
      ? Math.max(0, Math.round((lead.expiresAt.getTime() - Date.now()) / 60_000))
      : null
    const expiryNote = minutesLeft != null ? ` · ${minutesLeft} min left` : ''

    try {
      const { sendCtaUrl } = await import('./whatsapp-interactive')
      const { getProviderLeadAccessUrl } = await import('./provider-lead-access')
      const leadUrl = await getProviderLeadAccessUrl({
        leadId: lead.id,
        providerId: lead.providerId,
      })
      if (!leadUrl) {
        throw new Error('Missing provider lead access URL')
      }
      await sendCtaUrl(
        lead.provider.phone,
        `⏰ *Reminder — Lead Still Available*\n\n*${lead.jobRequest.category}* · ${area}\nRef: ${ref}${expiryNote}\n\nThis lead hasn't had a response yet. Tap to view and decide.`,
        'View Lead',
        leadUrl,
        { footer: 'Accept, inspect, or decline from the lead page' },
      )
      await db.lead.update({ where: { id: lead.id }, data: { reminderSentAt: new Date() } })
      sent++
    } catch (err) {
      console.error(`[matching] Failed to send lead reminder for lead ${lead.id}:`, err)
    }
  }

  return sent
}
