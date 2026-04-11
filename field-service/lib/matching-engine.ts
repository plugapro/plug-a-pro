// ─── Matching Engine Compatibility Layer ─────────────────────────────────────
// Preserves the existing lead-based entry points used by WhatsApp and cron while
// delegating ranking, scheduling, scoring, and fallback orchestration to the
// production matcher domain in ./matching/service.

import { db } from './db'
import {
  acceptAssignmentOffer,
  processPendingAssignmentWorkflows,
  rejectAssignmentOffer,
  runAssignmentForJobRequest,
} from './matching/service'

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
  const providers = await db.provider.findMany({
    where: { active: true, verified: true },
    include: {
      technicianSkills: true,
      technicianServiceAreas: true,
    },
  })

  const category = input.category.trim().toLowerCase()
  const suburb = input.suburb.trim().toLowerCase()
  const city = input.city.trim().toLowerCase()

  return providers.filter((provider) => {
    const providerSkills = [
      ...provider.skills,
      ...provider.technicianSkills.map((skill) => skill.skillTag),
    ].map((skill) => skill.toLowerCase())
    const areas = [
      ...provider.serviceAreas,
      ...provider.technicianServiceAreas.map((area) => area.label),
      ...provider.technicianServiceAreas.map((area) => area.city ?? ''),
    ].map((area) => area.toLowerCase()).filter(Boolean)

    return (
      provider.availableNow &&
      providerSkills.includes(category) &&
      (areas.includes(suburb) || areas.includes(city))
    )
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

  if (!result.ok) {
    return result
  }

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
    if (result.reason === 'EXPIRED' || result.reason === 'TAKEN') {
      return { ok: true }
    }
    return { ok: false, reason: result.reason }
  }

  return { ok: true }
}

export async function expireStaleLeads(): Promise<number> {
  const result = await processPendingAssignmentWorkflows()
  return result.expiredOffers
}
