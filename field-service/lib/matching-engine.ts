// ─── Matching Engine Compatibility Layer ─────────────────────────────────────
// Preserves the existing lead-based entry points used by WhatsApp and cron while
// delegating ranking, scheduling, scoring, and fallback orchestration to the
// production matcher domain in ./matching/service.

import { db } from './db'
import { ctaLabelFor } from './whatsapp-copy'
import { MATCHING_CONFIG } from './matching/config'
import {
  processPendingAssignmentWorkflows,
  rejectAssignmentOffer,
  runAssignmentForJobRequest,
} from './matching/service'

export interface CandidateInput {
  category: string
  suburb: string
  city: string
  regionKey?: string | null
  isTestRequest?: boolean
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
  matchId?: string | null
  creditTransactionId?: string | null
  currentCreditBalance?: number
  alreadyAccepted?: boolean
  alreadyUnlocked?: boolean
  creditApplied?: boolean
  creditCheck?: {
    ok: boolean
    reason?: string
    requiredCredits?: number
    currentCreditBalance?: number
    providerMessage?: string
  }
  inspectionNeeded: boolean
  notificationSent: boolean
}

type LeadRejected = {
  ok: false
  reason:
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'EXPIRED'
    | 'TAKEN'
    | 'INSUFFICIENT_CREDITS'
    | 'IDENTITY_NOT_VERIFIED'
    | 'PROVIDER_NOT_APPROVED'
    | 'WALLET_SUSPENDED'
    | 'CONCURRENT_UNLOCK'
    | 'LEAD_ACCEPTANCE_FAILED'
  currentCreditBalance?: number
  traceId?: string
}

export type LeadAcceptanceResult = LeadAccepted | LeadRejected

export async function findCandidateProviders(input: CandidateInput) {
  const providers = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      isTestUser: Boolean(input.isTestRequest),
    },
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
  source?: 'whatsapp' | 'pwa' | 'api'
  traceId?: string
}): Promise<LeadAcceptanceResult> {
  const selectedLead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      jobRequestId: true,
      providerId: true,
      customerSelectedAt: true,
      jobRequest: {
        select: {
          status: true,
          assignmentMode: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
        },
      },
    },
  })

  if (!selectedLead) {
    return { ok: false, reason: 'NOT_FOUND' }
  }

  // OPS_REVIEW: ops dispatched directly — no customer-selection step. Atomically
  // claim PROVIDER_CONFIRMATION_PENDING for this provider so the standard
  // acceptSelectedProviderJob path can proceed unchanged.
  let opsReviewDirectClaim = false
  if (selectedLead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING') {
    if (
      selectedLead.jobRequest.assignmentMode === 'OPS_REVIEW' &&
      selectedLead.jobRequest.status === 'MATCHING' &&
      selectedLead.providerId === params.providerId
    ) {
      const now = new Date()
      const claimed = await db.$transaction(async (tx) => {
        const jrUpdate = await tx.jobRequest.updateMany({
          where: { id: selectedLead.jobRequestId, status: 'MATCHING' },
          data: {
            status: 'PROVIDER_CONFIRMATION_PENDING',
            selectedProviderId: params.providerId,
            selectedLeadInviteId: params.leadId,
          },
        })
        if (jrUpdate.count === 0) return false
        await tx.lead.update({
          where: { id: params.leadId },
          data: { customerSelectedAt: now, status: 'CUSTOMER_SELECTED' },
        })
        return true
      })
      if (!claimed) return { ok: false, reason: 'EXPIRED' }
      opsReviewDirectClaim = true
    } else {
      return { ok: false, reason: 'EXPIRED' }
    }
  }
  // For standard REVIEW_FIRST (customer-selected) leads, validate the snapshot
  // still matches what was set by selectShortlistedProviderForRequest.
  if (
    !opsReviewDirectClaim && (
      !selectedLead.customerSelectedAt ||
      selectedLead.jobRequest.selectedProviderId !== params.providerId ||
      selectedLead.jobRequest.selectedLeadInviteId !== params.leadId
    )
  ) {
    return { ok: false, reason: 'FORBIDDEN' }
  }

  const { acceptSelectedProviderJob } = await import('./selected-provider-acceptance')
  const selectedResult = await acceptSelectedProviderJob({
    leadId: params.leadId,
    providerId: params.providerId,
    source: params.source,
    traceId: params.traceId,
  })

  if (!selectedResult.ok) {
    if (
      selectedResult.reason === 'PROVIDER_NOT_SELECTED' ||
      selectedResult.reason === 'LEAD_INVITE_NOT_SELECTED'
    ) {
      return { ok: false, reason: 'FORBIDDEN' }
    }
    if (
      selectedResult.reason === 'LEAD_EXPIRED' ||
      selectedResult.reason === 'REQUEST_NOT_AWAITING_CONFIRMATION'
    ) {
      return { ok: false, reason: 'EXPIRED' }
    }
    if (selectedResult.reason === 'DUPLICATE_ACCEPT_IGNORED') {
      return { ok: false, reason: 'CONCURRENT_UNLOCK' }
    }
    if (selectedResult.reason === 'IDENTITY_NOT_VERIFIED') {
      return { ok: false, reason: 'IDENTITY_NOT_VERIFIED' }
    }
    return { ok: false, reason: 'LEAD_ACCEPTANCE_FAILED' }
  }

  return {
    ok: true,
    leadId: selectedResult.leadId,
    matchId: selectedResult.matchId,
    creditTransactionId: selectedResult.creditTransactionId,
    currentCreditBalance: selectedResult.currentCreditBalance,
    alreadyAccepted: selectedResult.alreadyAccepted,
    alreadyUnlocked: selectedResult.alreadyUnlocked,
    creditApplied: selectedResult.creditApplied,
    creditCheck: {
      ok: selectedResult.creditCheck.ok,
      reason: selectedResult.creditCheck.ok ? undefined : selectedResult.creditCheck.reason,
      requiredCredits: selectedResult.creditCheck.requiredCredits,
      currentCreditBalance: selectedResult.creditCheck.currentCreditBalance,
      providerMessage: selectedResult.creditCheck.providerMessage,
    },
    inspectionNeeded: false,
    notificationSent: selectedResult.notificationSent,
  }
}

export async function declineLead(params: {
  leadId: string
  providerId: string
}): Promise<{ ok: true; alreadyClosed?: true; alreadyDeclined?: true } | { ok: false; reason: 'NOT_FOUND' | 'FORBIDDEN' }> {
  const selectedLead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      status: true,
      providerId: true,
      jobRequest: {
        select: {
          status: true,
          selectedLeadInviteId: true,
        },
      },
    },
  })

  if (!selectedLead) return { ok: false, reason: 'NOT_FOUND' }
  if (selectedLead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }

  if (
    selectedLead.status === 'CUSTOMER_SELECTED' ||
    selectedLead.status === 'DECLINED' ||
    selectedLead.jobRequest.selectedLeadInviteId === selectedLead.id ||
    selectedLead.jobRequest.status === 'PROVIDER_CONFIRMATION_PENDING'
  ) {
    const { declineSelectedProviderJob } = await import('./customer-shortlists')
    const selectedResult = await declineSelectedProviderJob(params)
    if (selectedResult.ok) {
      return 'alreadyDeclined' in selectedResult && selectedResult.alreadyDeclined
        ? { ok: true, alreadyDeclined: true }
        : { ok: true }
    }
    if (selectedResult.reason === 'NOT_FOUND' || selectedResult.reason === 'FORBIDDEN') {
      return { ok: false, reason: selectedResult.reason }
    }
    return { ok: true, alreadyClosed: true }
  }

  const result = await rejectAssignmentOffer(params)
  if (!result.ok) {
    if (result.reason === 'EXPIRED' || result.reason === 'TAKEN') return { ok: true, alreadyClosed: true }
    if (result.reason !== 'NOT_FOUND' && result.reason !== 'FORBIDDEN') return { ok: true }
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
      provider: {
        active: true,
        status: 'ACTIVE',
      },
      jobRequest: {
        status: { in: ['OPEN', 'MATCHING', 'SHORTLIST_READY', 'PROVIDER_CONFIRMATION_PENDING'] },
      },
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
    const millisUntilExpiry = lead.expiresAt ? lead.expiresAt.getTime() - Date.now() : null
    if (millisUntilExpiry != null && millisUntilExpiry <= 0) {
      console.info('[matching] lead reminder skipped because lead is already expired at send time', {
        leadId: lead.id,
        providerId: lead.providerId,
        expiresAt: lead.expiresAt,
      })
      continue
    }

    const area = lead.jobRequest.address
      ? [lead.jobRequest.address.suburb, lead.jobRequest.address.city].filter(Boolean).join(', ')
      : 'your area'
    const ref = lead.id.slice(-8).toUpperCase()
    const minutesLeft = millisUntilExpiry != null ? Math.ceil(millisUntilExpiry / 60_000) : null
    const isExpiringSoon = millisUntilExpiry != null && millisUntilExpiry < 60_000
    const expiryNote = isExpiringSoon
      ? ' · expires soon'
      : minutesLeft != null
        ? ` · ${minutesLeft} min left`
        : ''

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
      const reminderTitle = isExpiringSoon
        ? '⏰ *Reminder — Lead Expires Soon*'
        : '⏰ *Reminder — Lead Still Available*'
      await sendCtaUrl(
        lead.provider.phone,
        `${reminderTitle}\n\n*${lead.jobRequest.category}* · ${area}\nRef: ${ref}${expiryNote}\n\nThis lead hasn't had a response yet. Tap to view and decide.`,
        ctaLabelFor('view_lead'),
        leadUrl,
        { footer: 'View the lead preview. Accepting uses 1 credit.' },
      )
      await db.lead.update({ where: { id: lead.id }, data: { reminderSentAt: new Date() } })
      sent++
    } catch (err) {
      console.error(`[matching] Failed to send lead reminder for lead ${lead.id}:`, err)
    }
  }

  return sent
}
