import type {
  AssignmentHoldStatus,
  AssignmentMode,
  BookingStatus,
  DispatchDecisionStatus,
  JobStatus,
  JobRequestStatus,
  LeadStatus,
  MatchAttemptStage,
  Prisma,
  MessageStatus,
} from '@prisma/client'
import { db } from '../db'
import { MATCHING_CONFIG, type MatchingWeights } from './config'
import { buildWorkingWindow, deriveRequestWindow, evaluateScheduleFit, normalizeCommitments } from './scheduling'
import { resolveCategoryRequirements } from '../category-config'
import { isLocationStale, pointFallsWithinRadius } from './geography'
import { createBookingArtifactsForApprovedQuote } from '../quotes'
import { initializeBookingPayment } from '../payments'
import { emitMatchEvent } from './events'
import { notifyExpiredJobParties } from './customer-recontact'
import { expireOpenJobRequest } from '../job-requests/expire-job-request'
import { getUrgencyMatchingPolicy } from '../urgency'
import { releaseProviderCapacity } from './reservation'
import { sendText } from '../whatsapp-interactive'
import { hasSuccessfulMessageForRecipient } from '../message-events'
import { createTraceId } from '../support-diagnostics'
import { LEAD_UNLOCK_COST_CREDITS, LeadUnlockError, unlockLeadForProviderInTransaction } from '../lead-unlocks'
import { normaliseLocationDisplayName } from '../location-format'
import { buildProviderLeadActionsMessage } from '../provider-credit-copy'
import { isOutsideStandardLeadHours } from './filter'
import type {
  CoverageTier,
  DispatchActor,
  DispatchHistoryResult,
  DispatchRunResult,
  MatchingAddress,
  MatchingJobRequest,
  MatchingProvider,
  OfferResolutionResult,
  RankedCandidate,
  RankingResult,
  ScoreBreakdown,
} from './types'

type ResolvedCategoryRequirements = Awaited<ReturnType<typeof resolveCategoryRequirements>>

const OFFER_TIMEOUT_CONSECUTIVE_PAUSE_THRESHOLD = 3
const OFFER_TIMEOUT_HARD_PAUSE_THRESHOLD = 6
const OFFER_TIMEOUT_PAUSE_WINDOW_HOURS = 24
const OFFER_TIMEOUT_TEMP_PAUSE_HOURS = 12
const ACCEPT_ASSIGNMENT_TRANSACTION_TIMEOUT_MS = 20_000
const ACCEPT_ASSIGNMENT_TRANSACTION_MAX_WAIT_MS = 10_000
const LEAD_NOTIFICATION_TEMPLATES = ['quick_match_provider_lead_offer', 'provider_lead_offer', 'provider_rfp_lead_invite'] as const
const LEAD_ACTION_TEMPLATES = ['dispatch:job_lead_actions', 'rfp:job_lead_actions'] as const
const LEAD_MESSAGE_SUCCESS_STATES: MessageStatus[] = ['SENT', 'DELIVERED', 'READ']
const LEAD_MESSAGE_TEMPLATES = [...LEAD_NOTIFICATION_TEMPLATES, ...LEAD_ACTION_TEMPLATES]

type ExpiredAssignmentNotificationHold = {
  id: string
  expiresAt: Date
  jobRequestId: string
  providerId: string
  provider: { phone: string | null; name: string | null } | null
  jobRequest: {
    category: string
    address: { suburb: string | null; city: string | null } | null
  } | null
}

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase()
}

function isSchemaCompatError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? (error as { code?: string }).code : undefined
  return code === 'P2021' || code === 'P2022'
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return String((error as { code?: unknown }).code ?? '')
}

function remainingBalanceFromUnlock(
  ledgerEntries: Array<{
    balanceAfterPaidCredits: number
    balanceAfterPromoCredits: number
  }>,
  fallbackBalance: number,
) {
  const lastEntry = ledgerEntries.at(-1)
  if (!lastEntry) return fallbackBalance
  return lastEntry.balanceAfterPaidCredits + lastEntry.balanceAfterPromoCredits
}

function formatProviderLeadDeadline(deadline: Date) {
  return deadline.toLocaleString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })
}

function formatLeadExpiryArea(address: { suburb?: string | null; city?: string | null } | null | undefined) {
  const suburb = normaliseLocationDisplayName(address?.suburb)
  const city = normaliseLocationDisplayName(address?.city)
  if (suburb && city && suburb !== city) return `${suburb}, ${city}`
  return suburb || city || 'your area'
}

export type JobLeadNotificationTemplate = (typeof LEAD_MESSAGE_TEMPLATES)[number]
export type JobLeadNotificationProviderAudit = {
  leadId: string
  providerId: string
  providerName: string
  providerPhone: string | null
  leadStatus: LeadStatus
  leadSentAt: Date | null
  leadNotifiedAt: Date | null
  leadNotificationAttemptedAt: Date | null
  isNotified: boolean
  notNotifiedReason: string | null
  leadOfferTemplate: JobLeadNotificationTemplate | null
  leadOfferStatus: MessageStatus | null
  leadOfferFailureReason: string | null
  actionTemplate: JobLeadNotificationTemplate | null
  actionStatus: MessageStatus | null
  actionFailureReason: string | null
  latestMessageEventId: string | null
}

export type JobLeadNotificationSummary = {
  jobRequestId: string
  jobRequestStatus: JobRequestStatus
  assignmentMode: AssignmentMode | null
  providers: JobLeadNotificationProviderAudit[]
}

type MessageEventForLead = {
  id: string
  templateName: string
  status: MessageStatus
  sentAt: Date | null
  failureReason: string | null
  createdAt: Date
  to: string
  metadata: Prisma.JsonValue
}

function isSuccessfulMessageStatus(status: MessageStatus | null | undefined) {
  return Boolean(status && LEAD_MESSAGE_SUCCESS_STATES.includes(status))
}

function getMessageFailureReason(event: MessageEventForLead | null | undefined): string | null {
  return event?.failureReason ?? null
}

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function latestByCreatedAt(events: MessageEventForLead[]) {
  return events
    .slice()
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null
}

function summarizeLeadNotification(params: {
  leadStatus: LeadStatus
  leadNotificationAttemptedAt: Date | null
  leadNotifiedAt: Date | null
  leadOfferEvents: MessageEventForLead[]
  actionEvents: MessageEventForLead[]
  hasProviderPhone: boolean
  isActiveLead: boolean
}) {
  const {
    leadStatus,
    leadNotificationAttemptedAt,
    leadNotifiedAt,
    leadOfferEvents,
    actionEvents,
    hasProviderPhone,
    isActiveLead,
  } = params

  const successfulOffer = leadOfferEvents.find((event) => isSuccessfulMessageStatus(event.status))
  const latestOffer = latestByCreatedAt(leadOfferEvents)
  const latestAction = latestByCreatedAt(actionEvents)
  const latestOfferFailure = leadOfferEvents
    .filter((event) => !isSuccessfulMessageStatus(event.status))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null
  const latestActionFailure = actionEvents
    .filter((event) => !isSuccessfulMessageStatus(event.status))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null

  if (successfulOffer) {
    return {
      isNotified: true as const,
      notNotifiedReason: null,
      leadOfferTemplate: successfulOffer.templateName as JobLeadNotificationTemplate,
      leadOfferStatus: successfulOffer.status,
      leadOfferFailureReason: null,
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: successfulOffer.id,
    }
  }

  if (!isActiveLead) {
    return {
      isNotified: false as const,
      notNotifiedReason: 'Lead is closed or declined for this provider.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOffer?.id ?? latestAction?.id ?? null,
    }
  }

  if (!hasProviderPhone) {
    return {
      isNotified: false as const,
      notNotifiedReason: 'Provider phone is missing; notification could not be sent.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOffer?.id ?? latestAction?.id ?? null,
    }
  }

  if (leadStatus === 'SEND_PENDING') {
    return {
      isNotified: false as const,
      notNotifiedReason: 'Notification is pending, awaiting WhatsApp delivery callback.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOffer?.id ?? latestAction?.id ?? null,
    }
  }

  if (latestOfferFailure) {
    const latestOfferFailureReason = getMessageFailureReason(latestOfferFailure)

    return {
      isNotified: false as const,
      notNotifiedReason: `Lead offer send failed: ${latestOfferFailureReason ?? 'No failure reason supplied'}`,
      leadOfferTemplate: latestOfferFailure.templateName as JobLeadNotificationTemplate,
      leadOfferStatus: latestOfferFailure.status,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOfferFailure.id,
    }
  }

  if (actionEvents.length > 0) {
    return {
      isNotified: false as const,
      notNotifiedReason: 'Lead offer template has not been successfully sent.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestAction?.id ?? null,
    }
  }

  if (leadNotifiedAt) {
    return {
      isNotified: false as const,
      notNotifiedReason: 'Lead has notify timestamp but no matching offer event was recorded.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOffer?.id ?? latestAction?.id ?? null,
    }
  }

  if (leadNotificationAttemptedAt) {
    return {
      isNotified: false as const,
      notNotifiedReason: 'Notification attempted but no outbound lead-offer event was successful.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOffer?.id ?? latestAction?.id ?? null,
    }
  }

  return {
    isNotified: false as const,
      notNotifiedReason: 'No lead-offer message was recorded.',
      leadOfferTemplate: latestOffer?.templateName as JobLeadNotificationTemplate | null,
      leadOfferStatus: latestOffer?.status ?? null,
      leadOfferFailureReason: getMessageFailureReason(latestOfferFailure),
      actionTemplate: (latestAction?.templateName ?? null) as JobLeadNotificationTemplate | null,
      actionStatus: latestAction?.status ?? null,
      actionFailureReason: getMessageFailureReason(latestActionFailure),
      latestMessageEventId: latestOffer?.id ?? latestAction?.id ?? null,
    }
  }

export async function getLeadNotificationSummaryForJobRequest(
  jobRequestId: string,
): Promise<JobLeadNotificationSummary | null> {
  // Keep a narrow, deterministic query path for diagnostics: job status + lead rows + message events.
  const request = await db.jobRequest.findUnique({
    where: { id: jobRequestId },
    select: {
      id: true,
      status: true,
      assignmentMode: true,
    },
  })
  if (!request) return null

  const leads = await db.lead.findMany({
    where: { jobRequestId },
    include: {
      provider: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
    },
    orderBy: { sentAt: 'asc' },
  })

  const messageEvents = await db.messageEvent.findMany({
    where: {
      templateName: { in: LEAD_MESSAGE_TEMPLATES },
      OR: [
        { metadata: { path: ['jobRequestId'], equals: request.id } },
        { metadata: { path: ['requestId'], equals: request.id } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      templateName: true,
      status: true,
      sentAt: true,
      failureReason: true,
      createdAt: true,
      to: true,
      metadata: true,
    },
  })

  const byLeadId = new Map<string, MessageEventForLead[]>()
  const byProviderId = new Map<string, MessageEventForLead[]>()
  for (const messageEvent of messageEvents) {
    if (!messageEvent.templateName) continue
    const mapped = messageEvent as MessageEventForLead

    const leadId = metadataValue(mapped.metadata, 'leadId')
    const providerId = metadataValue(mapped.metadata, 'providerId')

    if (leadId) {
      const rows = byLeadId.get(leadId) ?? []
      rows.push(mapped)
      byLeadId.set(leadId, rows)
    }
    if (providerId) {
      const rows = byProviderId.get(providerId) ?? []
      rows.push(mapped)
      byProviderId.set(providerId, rows)
    }
  }

  const providers = leads.map((lead) => {
    const byLead = byLeadId.get(lead.id) ?? []
    const byProvider = lead.providerId ? byProviderId.get(lead.providerId) ?? [] : []
    const eventByLeadAndProvider = byLead.concat(byProvider.filter((item) => !byLead.some((existing) => existing.id === item.id)))
    const leadOfferEvents = eventByLeadAndProvider.filter((event) =>
      LEAD_NOTIFICATION_TEMPLATES.includes(event.templateName as (typeof LEAD_NOTIFICATION_TEMPLATES)[number]),
    )
    const actionEvents = eventByLeadAndProvider.filter((event) =>
      LEAD_ACTION_TEMPLATES.includes(event.templateName as (typeof LEAD_ACTION_TEMPLATES)[number]),
    )
    const summary = summarizeLeadNotification({
      leadStatus: lead.status,
      leadNotificationAttemptedAt: lead.notificationAttemptedAt ?? null,
      leadNotifiedAt: lead.notifiedAt ?? null,
      leadOfferEvents,
      actionEvents,
      hasProviderPhone: Boolean(lead.provider?.phone),
      isActiveLead: lead.status !== 'DECLINED' && lead.status !== 'CANCELLED' && lead.status !== 'EXPIRED',
    })

    return {
      leadId: lead.id,
      providerId: lead.providerId,
      providerName: lead.provider?.name ?? lead.provider?.phone ?? lead.providerId,
      providerPhone: lead.provider?.phone ?? null,
      leadStatus: lead.status,
      leadSentAt: lead.sentAt,
      leadNotifiedAt: lead.notifiedAt,
      leadNotificationAttemptedAt: lead.notificationAttemptedAt ?? null,
      isNotified: summary.isNotified,
      notNotifiedReason: summary.notNotifiedReason,
      leadOfferTemplate: summary.leadOfferTemplate,
      leadOfferStatus: summary.leadOfferStatus,
      leadOfferFailureReason: summary.leadOfferFailureReason,
      actionTemplate: summary.actionTemplate,
      actionStatus: summary.actionStatus,
      actionFailureReason: summary.actionFailureReason,
      latestMessageEventId: summary.latestMessageEventId,
    }
  })

  return {
    jobRequestId: request.id,
    jobRequestStatus: request.status,
    assignmentMode: request.assignmentMode,
    providers,
  }
}

async function notifyCustomerProviderRotation(params: {
  jobRequestId: string
  reason: 'provider_declined' | 'provider_timeout'
  nextOfferedProviderId: string | null
}) {
  const request = await db.jobRequest.findUnique({
    where: { id: params.jobRequestId },
    select: {
      customer: { select: { phone: true } },
    },
  })
  const phone = request?.customer?.phone
  if (!phone) return

  const body = params.reason === 'provider_timeout'
    ? params.nextOfferedProviderId
      ? `That provider did not respond in time. We're checking with the next suitable provider.`
      : `That provider did not respond in time. We're continuing to check suitable providers now.`
    : params.nextOfferedProviderId
      ? `That provider is not available. We're checking with the next suitable provider.`
      : `That provider is not available. We're continuing to check suitable providers now.`

  await sendText(
    phone,
    body,
    {
      templateName: 'interactive:quick_match_rotation',
      metadata: {
        jobRequestId: params.jobRequestId,
        reason: params.reason,
        nextProviderFound: Boolean(params.nextOfferedProviderId),
      },
    },
  ).catch(() => undefined)
}

async function notifyProviderLeadInviteExpired(params: {
  hold: ExpiredAssignmentNotificationHold
  wasReassigned: boolean
  traceId: string
}) {
  const { hold, wasReassigned, traceId } = params
  const phone = hold.provider?.phone

  if (!phone) {
    console.warn('[expireAssignmentOffer] skipped provider expiry notification: missing provider phone', {
      trace_id: traceId,
      provider_id: hold.providerId,
      job_request_id: hold.jobRequestId,
      assignment_hold_id: hold.id,
      error_code: 'PROVIDER_PHONE_MISSING',
    })
    return
  }

  const alreadySent = await hasSuccessfulMessageForRecipient({
    to: phone,
    templateName: 'interactive:lead_expired',
    metadataPath: ['assignmentHoldId'],
    metadataEquals: hold.id,
  })

  if (alreadySent) {
    console.info('[expireAssignmentOffer] skipped duplicate provider expiry notification', {
      trace_id: traceId,
      provider_id: hold.providerId,
      job_request_id: hold.jobRequestId,
      assignment_hold_id: hold.id,
      result: 'duplicate_skipped',
    })
    return
  }

  const category = hold.jobRequest?.category || 'job'
  const area = formatLeadExpiryArea(hold.jobRequest?.address)
  const deadline = formatProviderLeadDeadline(hold.expiresAt)
  const reassignedLine = wasReassigned ? '\n\nThis lead has now been offered to another provider.' : ''

  await sendText(
    phone,
    `⏱️ *Lead expired*\n\nThe ${category} lead in ${area} expired because there was no response before ${deadline}.\n\nNo credits were used.${reassignedLine}\n\nWe'll send you another lead when one matches your area and availability.`,
    {
      templateName: 'interactive:lead_expired',
      metadata: {
        traceId,
        providerId: hold.providerId,
        jobRequestId: hold.jobRequestId,
        assignmentHoldId: hold.id,
        expiresAt: hold.expiresAt.toISOString(),
        wasReassigned,
      },
    },
  )
}

async function safeOptionalQuery<T>(factory: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await factory()
  } catch (error) {
    if (isSchemaCompatError(error)) {
      return fallback
    }
    throw error
  }
}

function isSameCalendarDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
}

async function safeOptionalMutation<T>(factory: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await factory()
  } catch (error) {
    if (isSchemaCompatError(error)) {
      return fallback
    }
    throw error
  }
}

async function pauseProviderAfterRepeatedOfferTimeouts(providerId: string) {
  const since = new Date(Date.now() - OFFER_TIMEOUT_PAUSE_WINDOW_HOURS * 60 * 60 * 1000)
  const timeoutHolds = await db.assignmentHold.findMany({
    where: {
      providerId,
      status: 'EXPIRED',
      outcomeReasonCode: 'OFFER_TIMEOUT',
      respondedAt: { gte: since },
    },
    select: { jobRequest: { select: { customerId: true } } },
  })
  const timeoutCount = timeoutHolds.length

  // Abuse guard: a single customer (or competitor) must not be able to force a
  // provider offline by spamming targeted job requests and letting the offers
  // expire. Only auto-pause when the timeouts originate from a diverse set of
  // customers, which is the signal of genuine provider unresponsiveness rather
  // than a targeted availability attack.
  const distinctTimeoutCustomers = new Set(
    timeoutHolds
      .map((hold) => hold.jobRequest?.customerId)
      .filter((id): id is string => Boolean(id)),
  )
  const MIN_DISTINCT_CUSTOMERS_FOR_PAUSE = 2
  const hasDiverseCustomers = distinctTimeoutCustomers.size >= MIN_DISTINCT_CUSTOMERS_FOR_PAUSE

  const recentResolvedHolds = await db.assignmentHold.findMany({
    where: {
      providerId,
      respondedAt: { gte: since },
      status: { in: ['ACCEPTED', 'REJECTED', 'EXPIRED', 'RELEASED', 'CANCELLED'] },
    },
    orderBy: { respondedAt: 'desc' },
    take: OFFER_TIMEOUT_CONSECUTIVE_PAUSE_THRESHOLD,
    select: { status: true, outcomeReasonCode: true },
  })
  const hasConsecutiveTimeouts =
    recentResolvedHolds.length >= OFFER_TIMEOUT_CONSECUTIVE_PAUSE_THRESHOLD &&
    recentResolvedHolds.every(
      (hold) => hold.status === 'EXPIRED' && hold.outcomeReasonCode === 'OFFER_TIMEOUT',
    )

  if (timeoutCount < OFFER_TIMEOUT_HARD_PAUSE_THRESHOLD && !hasConsecutiveTimeouts) {
    return { paused: false, timeoutCount }
  }

  // Even when thresholds are met, do not pause unless the timeouts came from
  // multiple distinct customers — prevents a single actor from weaponising the
  // auto-pause to take a competitor offline.
  if (!hasDiverseCustomers) {
    return { paused: false, timeoutCount, reason: 'INSUFFICIENT_CUSTOMER_DIVERSITY' }
  }

  const isHardPause = timeoutCount >= OFFER_TIMEOUT_HARD_PAUSE_THRESHOLD
  const breakUntil = new Date(Date.now() + OFFER_TIMEOUT_TEMP_PAUSE_HOURS * 60 * 60 * 1000)

  const provider = await db.provider.update({
    where: { id: providerId },
    data: {
      ...(isHardPause ? { availableNow: false } : {}),
      updatedAt: new Date(),
    },
    select: { id: true, phone: true, name: true },
  })
  await db.technicianAvailability.upsert({
    where: { providerId },
    create: {
      providerId,
      availabilityState: 'PAUSED',
      breakUntil: isHardPause ? null : breakUntil,
      notes: isHardPause
        ? 'Auto-paused after repeated offer timeouts; provider must go online manually.'
        : 'Auto-paused for 12 hours after consecutive offer timeouts.',
    },
    update: {
      availabilityState: 'PAUSED',
      breakUntil: isHardPause ? null : breakUntil,
      notes: isHardPause
        ? 'Auto-paused after repeated offer timeouts; provider must go online manually.'
        : 'Auto-paused for 12 hours after consecutive offer timeouts.',
      updatedAt: new Date(),
    },
  })

  await sendText(
    provider.phone,
    isHardPause
      ? `⏸️ *Leads paused*\n\nHi *${provider.name.split(' ')[0] || 'there'}*, we paused new Plug A Pro leads because several job offers expired without a response.\n\nReply *menu* when you're ready, then choose *Go Online* to receive leads again.`
      : `⏸️ *Leads paused for 12 hours*\n\nHi *${provider.name.split(' ')[0] || 'there'}*, the last few job offers expired without a response, so we paused new Plug A Pro leads for 12 hours.\n\nReply *menu* if you want to manage your availability.`,
    {
      templateName: 'interactive:provider_auto_paused_timeout',
      metadata: {
        providerId,
        timeoutCount,
        pauseType: isHardPause ? 'hard' : 'temporary',
        windowHours: OFFER_TIMEOUT_PAUSE_WINDOW_HOURS,
        ...(isHardPause ? {} : { breakUntil: breakUntil.toISOString() }),
      },
    },
  ).catch((error) => {
    console.error('[matching] Failed to notify provider about timeout pause:', { providerId, error })
  })

  if (isHardPause && process.env.ADMIN_WHATSAPP_NUMBER) {
    await sendText(
      process.env.ADMIN_WHATSAPP_NUMBER,
      `⚠️ *Provider leads paused*\n\n${provider.name} (${provider.phone}) has ${timeoutCount} offer timeouts in ${OFFER_TIMEOUT_PAUSE_WINDOW_HOURS}h and was taken offline for leads.`,
      {
        templateName: 'interactive:provider_timeout_admin_alert',
        metadata: { providerId, timeoutCount, windowHours: OFFER_TIMEOUT_PAUSE_WINDOW_HOURS },
      },
    ).catch((error) => {
      console.error('[matching] Failed to notify admin about provider timeout pause:', { providerId, error })
    })
  }

  emitMatchEvent({
    event: 'provider.auto_paused',
    providerId,
    reason: isHardPause ? 'repeated_offer_timeouts_hard' : 'consecutive_offer_timeouts',
    timeoutCount,
    windowHours: OFFER_TIMEOUT_PAUSE_WINDOW_HOURS,
    pauseType: isHardPause ? 'hard' : 'temporary',
  })

  return { paused: true, timeoutCount, pauseType: isHardPause ? 'hard' : 'temporary' }
}

function buildMatchingJobRequest(record: {
  id: string
  customerId: string
  category: string
  title: string
  description: string
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  requestedArrivalLatest: Date | null
  estimatedDurationMinutes: number | null
  requiredSkillTags: string[]
  requiredCertificationCodes: string[]
  requiredEquipmentTags: string[]
  requiredVehicleTypes: string[]
  preferredProviderId: string | null
  assignmentMode: AssignmentMode
  customerAcceptedAmount: Prisma.Decimal | null
  customerAcceptedScope: string | null
  autoCreateBookingOnAssignment: boolean
  latestDispatchDecisionId: string | null
  isTestRequest: boolean
  cohortName: string | null
  providerPreference: string | null
  status: MatchingJobRequest['status']
  expiresAt?: Date | null
  matchFoundWhatsappSentAt?: Date | null
  customer?: { id: string; name: string; phone: string } | null
  address?: {
    street: string
    suburb: string
    city: string
    province: string
    lat: number | null
    lng: number | null
    locationNodeId: string | null
    locationNode: { regionKey: string | null; provinceKey: string | null } | null
  } | null
}) {
  return {
    id: record.id,
    customerId: record.customerId,
    category: record.category,
    title: record.title,
    description: record.description,
    requestedWindowStart: record.requestedWindowStart,
    requestedWindowEnd: record.requestedWindowEnd,
    requestedArrivalLatest: record.requestedArrivalLatest,
    estimatedDurationMinutes: record.estimatedDurationMinutes,
    requiredSkillTags: record.requiredSkillTags,
    requiredCertificationCodes: record.requiredCertificationCodes,
    preferredProviderId: record.preferredProviderId,
    assignmentMode: record.assignmentMode,
    requiredEquipmentTags: record.requiredEquipmentTags,
    requiredVehicleTypes: record.requiredVehicleTypes,
    customerAcceptedAmount: record.customerAcceptedAmount,
    customerAcceptedScope: record.customerAcceptedScope,
    autoCreateBookingOnAssignment: record.autoCreateBookingOnAssignment,
    latestDispatchDecisionId: record.latestDispatchDecisionId,
    isTestRequest: record.isTestRequest,
    cohortName: record.cohortName,
    providerPreference: record.providerPreference ?? null,
    status: record.status,
    expiresAt: record.expiresAt ?? null,
    matchFoundWhatsappSentAt: record.matchFoundWhatsappSentAt ?? null,
    customer: record.customer ?? { id: record.customerId, name: 'Customer', phone: '' },
    address: record.address
      ? {
          street: record.address.street,
          suburb: record.address.suburb,
          city: record.address.city,
          province: record.address.province,
          lat: record.address.lat,
          lng: record.address.lng,
          locationNodeId: record.address.locationNodeId ?? null,
          regionKey: record.address.locationNode?.regionKey ?? null,
          provinceKey: record.address.locationNode?.provinceKey ?? null,
        }
      : null,
  }
}

export async function loadMatchingJobRequest(client: any, jobRequestId: string) {
  const query = {
    where: { id: jobRequestId },
    select: {
      id: true,
      customerId: true,
      category: true,
      title: true,
      description: true,
      requestedWindowStart: true,
      requestedWindowEnd: true,
      requestedArrivalLatest: true,
      estimatedDurationMinutes: true,
      requiredSkillTags: true,
      requiredCertificationCodes: true,
      requiredEquipmentTags: true,
      requiredVehicleTypes: true,
      preferredProviderId: true,
      assignmentMode: true,
      customerAcceptedAmount: true,
      customerAcceptedScope: true,
      autoCreateBookingOnAssignment: true,
      latestDispatchDecisionId: true,
      isTestRequest: true,
      cohortName: true,
      providerPreference: true,
      status: true,
      expiresAt: true,
      matchFoundWhatsappSentAt: true,
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      address: {
        select: {
          street: true,
          suburb: true,
          city: true,
          province: true,
          lat: true,
          lng: true,
          locationNodeId: true,
          locationNode: {
            select: { regionKey: true, provinceKey: true },
          },
        },
      },
    },
  }

  const record =
    (await client.jobRequest.findUnique?.(query)) ??
    (await client.jobRequest.findUniqueOrThrow?.(query))

  if (!record) {
    throw new Error('JOB_REQUEST_NOT_FOUND')
  }

  return buildMatchingJobRequest(record)
}

async function releaseAssignmentHoldScheduleItems(
  client: any,
  where: Record<string, unknown>,
) {
  await safeOptionalMutation(
    () =>
      client.technicianScheduleItem.updateMany({
        where,
        data: {
          status: 'RELEASED',
          updatedAt: new Date(),
        },
      }),
    { count: 0 },
  )
}

async function createAssignmentHoldScheduleItem(
  client: any,
  data: Record<string, unknown>,
) {
  await safeOptionalMutation(
    () => client.technicianScheduleItem.create({ data }),
    null,
  )
}

async function loadProviderOfferContact(client: any, providerId: string) {
  return client.provider.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      id: true,
      phone: true,
      name: true,
    },
  })
}

function getReliabilityScore(provider: MatchingProvider) {
  if (provider.completedJobsCount === 0) {
    return provider.reliabilityScore || 0.5
  }

  return Math.min(
    1,
    Math.max(
      0,
      provider.reliabilityScore * 0.3 +
        provider.onTimeRate * 0.2 +
        provider.punctualityScore * 0.2 +
        (1 - provider.cancellationRate) * 0.1 +
        (1 - provider.complaintRate) * 0.1 +
        provider.acceptanceRate * 0.05 +
        Math.min(provider.averageRating / 5, 1) * 0.05,
    ),
  )
}

function buildDispatchIdempotencyKey(params: {
  jobRequest: MatchingJobRequest
  mode: AssignmentMode
}) {
  return JSON.stringify({
    jobRequestId: params.jobRequest.id,
    category: normalizeTag(params.jobRequest.category),
    mode: params.mode,
    requestedWindowStart: params.jobRequest.requestedWindowStart?.toISOString() ?? null,
    requestedWindowEnd: params.jobRequest.requestedWindowEnd?.toISOString() ?? null,
    requestedArrivalLatest: params.jobRequest.requestedArrivalLatest?.toISOString() ?? null,
    estimatedDurationMinutes: params.jobRequest.estimatedDurationMinutes ?? null,
    requiredSkillTags: [...params.jobRequest.requiredSkillTags].sort(),
    requiredCertificationCodes: [...params.jobRequest.requiredCertificationCodes].sort(),
    requiredEquipmentTags: [...params.jobRequest.requiredEquipmentTags].sort(),
    requiredVehicleTypes: [...params.jobRequest.requiredVehicleTypes].sort(),
    preferredProviderId: params.jobRequest.preferredProviderId ?? null,
    autoCreateBookingOnAssignment: params.jobRequest.autoCreateBookingOnAssignment,
    customerAcceptedAmount: params.jobRequest.customerAcceptedAmount?.toString() ?? null,
  })
}

function hasRequiredSkills(jobRequest: MatchingJobRequest, provider: MatchingProvider) {
  const requiredSkills = new Set(
    (jobRequest.requiredSkillTags.length > 0
      ? jobRequest.requiredSkillTags
      : [jobRequest.category]
    ).map(normalizeTag),
  )

  const providerSkills = new Set(
    [
      ...provider.skills,
      ...provider.technicianSkills.map((skill) => skill.skillTag),
    ].map(normalizeTag),
  )

  return [...requiredSkills].every((skill) => providerSkills.has(skill))
}

function getMissingRequiredCertifications(
  requirements: ResolvedCategoryRequirements,
  provider: MatchingProvider,
) {
  if (requirements.requiredCertificationCodes.length === 0) return []

  // Legacy TechnicianCertification records (original model)
  const activeLegacyCerts = new Set(
    provider.technicianCertifications
      .filter((cert) => cert.status !== 'EXPIRED')
      .map((cert) => normalizeTag(cert.certificationCode)),
  )

  // WS-B.1 ProviderCertification records - verified (verifiedAt set) certs by name.
  // An expired certification (expiresAt in the past) must NOT satisfy a regulated
  // requirement, so reject any record whose expiresAt has elapsed.
  const now = new Date()
  const adminVerifiedCerts = new Set(
    (provider.adminCertifications ?? [])
      .filter((cert) => cert.verifiedAt != null)
      .filter((cert) => cert.expiresAt == null || cert.expiresAt >= now)
      .map((cert) => normalizeTag(cert.name)),
  )

  return requirements.requiredCertificationCodes
    .map(normalizeTag)
    .filter((code) => !activeLegacyCerts.has(code) && !adminVerifiedCerts.has(code))
}

function getMissingRequiredEquipmentTags(
  requirements: ResolvedCategoryRequirements,
  provider: MatchingProvider,
) {
  if (requirements.requiredEquipmentTags.length === 0) return []

  // Legacy equipmentTags string array (original model)
  const legacyEquipment = new Set(provider.equipmentTags.map(normalizeTag))

  // WS-B.1 ProviderEquipment records - active equipment by label and category
  const adminEquipment = new Set([
    ...(provider.equipment ?? [])
      .filter((eq) => eq.active)
      .flatMap((eq) => [
        normalizeTag(eq.label),
        ...(eq.category ? [normalizeTag(eq.category)] : []),
      ]),
  ])

  return requirements.requiredEquipmentTags
    .map(normalizeTag)
    .filter((tag) => !legacyEquipment.has(tag) && !adminEquipment.has(tag))
}

function hasRequiredVehicleTypes(
  requirements: ResolvedCategoryRequirements,
  provider: MatchingProvider,
) {
  if (requirements.requiredVehicleTypes.length === 0) return true

  const providerVehicles = new Set(provider.vehicleTypes.map(normalizeTag))
  return requirements.requiredVehicleTypes
    .map(normalizeTag)
    .some((vehicleType) => providerVehicles.has(vehicleType))
}

function providerCoversAddress(
  provider: MatchingProvider,
  address: MatchingAddress,
): { covers: boolean; tier: CoverageTier } {
  const activeAreas = provider.technicianServiceAreas.filter((a) => a.active)

  // Tier 1 - RADIUS: haversine check (unchanged from existing logic)
  if (address.lat != null && address.lng != null) {
    const radiusAreas = activeAreas.filter(
      (area) =>
        area.areaType === 'RADIUS' &&
        area.lat != null &&
        area.lng != null &&
        area.radiusKm != null &&
        pointFallsWithinRadius({
          center: { lat: area.lat!, lng: area.lng! },
          point: { lat: address.lat!, lng: address.lng! },
          radiusKm: area.radiusKm!,
        }),
    )
    if (radiusAreas.length > 0) return { covers: true, tier: 'RADIUS' }
  }

  // Tier 2 - structured path (only when address has a locationNodeId)
  if (address.locationNodeId != null) {
    // Tier 2a - SUBURB_EXACT: provider has a row with matching locationNodeId
    const exactMatch = activeAreas.some(
      (area) => area.locationNodeId === address.locationNodeId,
    )
    if (exactMatch) return { covers: true, tier: 'SUBURB_EXACT' }

    // Tier 2b - REGION_FALLBACK: provider has an actual REGION coverage row for
    // the same region. A SUBURB row that merely carries a denormalised regionKey
    // must NOT confer region-wide coverage — otherwise a provider who configured a
    // single suburb would receive leads across the whole region.
    if (address.regionKey != null) {
      const regionMatch = activeAreas.some(
        (area) => area.areaType === 'REGION' && area.regionKey === address.regionKey,
      )
      if (regionMatch) return { covers: true, tier: 'REGION_FALLBACK' }
    }

    // Structured address but no match found - do NOT fall through to string matching
    return { covers: false, tier: 'NO_MATCH' }
  }

  // Tier 3 - LEGACY_STRING: fallback for providers/addresses without structured areas
  // Only active during migration window (controlled by config flag)
  if (!MATCHING_CONFIG.allowLegacyStringFallback) {
    return { covers: false, tier: 'NO_MATCH' }
  }

  const addressTerms = [address.suburb, address.city]
    .map((value) => normalizeTag(value ?? ''))
    .filter(Boolean)

  const providerAreaTerms = [
    ...provider.serviceAreas,
    ...activeAreas.map((a) => a.label),
    ...activeAreas.map((a) => a.city).filter(Boolean),
  ].map((v) => normalizeTag(v ?? '')).filter(Boolean)

  const hasStringMatch = addressTerms.some((term) => providerAreaTerms.includes(term))
  if (hasStringMatch) return { covers: true, tier: 'LEGACY_STRING' }

  return { covers: false, tier: 'NO_MATCH' }
}

function buildScoreBreakdown(params: {
  jobRequest: MatchingJobRequest
  provider: MatchingProvider
  scheduleFitScore: number
  travelMinutes: number
  canMeetWindow: boolean
  coverageTier: CoverageTier  // NEW
  categoryPolicy: ResolvedCategoryRequirements['policy']
  weights?: MatchingWeights
}) {
  const weights = params.weights ?? MATCHING_CONFIG.weights
  const skillMatch = hasRequiredSkills(params.jobRequest, params.provider) ? 1 : 0
  const scheduleFit = params.scheduleFitScore
  const travelEfficiency = Math.max(
    0,
    1 - params.travelMinutes / Math.max(params.provider.maxTravelMinutes, 1),
  )
  const reliability = getReliabilityScore(params.provider)
  const customerPreference =
    params.jobRequest.preferredProviderId === params.provider.id ? 1 : 0
  const marginEfficiency = Math.max(
    0,
    Math.min(1, (params.provider.maxTravelMinutes - params.travelMinutes) / Math.max(params.provider.maxTravelMinutes, 1)),
  )

  const geographicPenalty =
    params.coverageTier === 'REGION_FALLBACK' ? MATCHING_CONFIG.regionFallbackPenalty : 0

  const total =
    (skillMatch * weights.skillMatch +
      scheduleFit * weights.scheduleFit +
      travelEfficiency * weights.travelEfficiency +
      reliability * weights.reliability +
      customerPreference * weights.customerPreference +
      marginEfficiency * weights.marginEfficiency)
    - geographicPenalty

  const reasons = [
    skillMatch === 1 ? 'Required skills matched' : 'Missing required skill coverage',
    params.canMeetWindow ? 'Can meet requested arrival window' : 'Window fit is weaker',
    `Estimated travel ${params.travelMinutes} minutes`,
    `Reliability score ${reliability.toFixed(2)}`,
  ]

  if (params.categoryPolicy.regulated) {
    reasons.push('Regulated service requirements checked')
  }

  if (!isLocationStale(params.provider.lastKnownLocationAt)) {
    reasons.push('Recent technician location available')
  }

  if (customerPreference > 0) {
    reasons.push('Preferred or repeat technician')
  }

  if (params.coverageTier === 'REGION_FALLBACK') {
    reasons.push('Matched on region - provider may not cover this exact suburb')
  }
  if (params.coverageTier === 'LEGACY_STRING') {
    reasons.push('Service area matched by name (legacy - structured areas not yet configured)')
  }

  reasons.push(
    params.provider.verified
      ? 'Marketplace-reviewed profile'
      : 'Profile pending marketplace review',
  )

  return {
    skillMatch,
    scheduleFit,
    travelEfficiency,
    reliability,
    customerPreference,
    marginEfficiency,
    geographicPenalty,
    workloadFairness: 1,
    total,
    reasons,
  } satisfies ScoreBreakdown
}

async function loadMatchingContext(jobRequestId: string) {
  const jobRequest = await loadMatchingJobRequest(db, jobRequestId)

  if (!jobRequest.address) {
    throw new Error('JOB_REQUEST_NOT_FOUND')
  }

  const baseProviders = await db.provider.findMany({
    where: {
      active: true,
      verified: true,
      status: 'ACTIVE',
      isTestUser: jobRequest.isTestRequest,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      isTestUser: true,
      cohortName: true,
      active: true,
      availableNow: true,
      verified: true,
      status: true,
      skills: true,
      serviceAreas: true,
    },
  })

  const providerIds = baseProviders.map((provider) => provider.id)
  type ScheduleRow = {
    providerId: string
    dayOfWeek: number
    startTime: string
    endTime: string
    active: boolean
  }
  type SkillRow = {
    providerId: string
    skillTag: string
  }
  type CertificationRow = {
    providerId: string
    certificationCode: string
    status: string
  }
  type ServiceAreaRow = {
    providerId: string
    label: string
    city: string | null
    active: boolean
    areaType: string
    lat: number | null
    lng: number | null
    radiusKm: number | null
    locationNodeId: string | null
    regionKey: string | null
  }
  type AvailabilityRow = {
    providerId: string
    availabilityMode: string | null
    availabilityState: string
    nextAvailableAt: Date | null
    breakUntil: Date | null
    emergencyAvailable?: boolean | null
    sameDayAvailable?: boolean | null
  }
  type ScheduleItemRow = {
    providerId: string
    id: string
    itemType: string
    title: string | null
    startAt: Date
    endAt: Date
    bufferBeforeMinutes: number
    bufferAfterMinutes: number
    locationLabel: string | null
    lat: number | null
    lng: number | null
    status: string
  }
  type MatchRow = {
    providerId: string
  }
  type ActiveJobRow = {
    providerId: string
    booking: {
      id: string
      scheduledDate: Date
      scheduledWindow: string | null
      status: string
    } | null
  }
  const activeStatuses: JobStatus[] = [
    'SCHEDULED',
    'EN_ROUTE',
    'ARRIVED',
    'STARTED',
    'PAUSED',
    'AWAITING_APPROVAL',
    'PENDING_COMPLETION_CONFIRMATION',
  ]

  const [scheduleRows, skillRows, certificationRows, areaRows, availabilityRows, scheduleItems, matchRows, activeJobs] =
    await Promise.all([
      safeOptionalQuery(
        () =>
          (db as any).providerSchedule?.findMany?.({
            where: { providerId: { in: providerIds }, active: true },
            select: { providerId: true, dayOfWeek: true, startTime: true, endTime: true, active: true },
          }) ?? Promise.resolve([]),
        [] as ScheduleRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianSkill?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: { providerId: true, skillTag: true },
          }) ?? Promise.resolve([]),
        [] as SkillRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianCertification?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: { providerId: true, certificationCode: true, status: true },
          }) ?? Promise.resolve([]),
        [] as CertificationRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianServiceArea?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: {
              providerId: true,
              label: true,
              city: true,
              active: true,
              areaType: true,
              lat: true,
              lng: true,
              radiusKm: true,
              locationNodeId: true,
              regionKey: true,
            },
          }) ?? Promise.resolve([]),
        [] as ServiceAreaRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianAvailability?.findMany?.({
            where: { providerId: { in: providerIds } },
            select: {
              providerId: true,
              availabilityMode: true,
              availabilityState: true,
              nextAvailableAt: true,
              breakUntil: true,
              emergencyAvailable: true,
              sameDayAvailable: true,
            },
          }) ?? Promise.resolve([]),
        [] as AvailabilityRow[],
      ),
      safeOptionalQuery(
        () =>
          (db as any).technicianScheduleItem?.findMany?.({
            where: {
              providerId: { in: providerIds },
              status: 'ACTIVE',
            },
            select: {
              providerId: true,
              id: true,
              itemType: true,
              title: true,
              startAt: true,
              endAt: true,
              bufferBeforeMinutes: true,
              bufferAfterMinutes: true,
              locationLabel: true,
              lat: true,
              lng: true,
              status: true,
            },
          }) ?? Promise.resolve([]),
        [] as ScheduleItemRow[],
      ),
      safeOptionalQuery(
        () =>
          db.match.findMany?.({
            where: {
              providerId: { in: providerIds },
              jobRequest: { customerId: jobRequest.customerId },
            },
            select: { providerId: true },
          }) ?? Promise.resolve([]),
        [] as MatchRow[],
      ),
      safeOptionalQuery(
        () =>
          db.job.findMany?.({
            where: {
              providerId: { in: providerIds },
              status: { in: activeStatuses },
            },
            select: {
              providerId: true,
              booking: {
                select: {
                  id: true,
                  scheduledDate: true,
                  scheduledWindow: true,
                  status: true,
                },
              },
            },
          }) ?? Promise.resolve([]),
        [] as ActiveJobRow[],
      ),
    ])

  const schedulesByProvider = new Map<string, typeof scheduleRows>()
  for (const row of scheduleRows) {
    const list = schedulesByProvider.get(row.providerId) ?? []
    list.push(row)
    schedulesByProvider.set(row.providerId, list)
  }

  const skillsByProvider = new Map<string, typeof skillRows>()
  for (const row of skillRows) {
    const list = skillsByProvider.get(row.providerId) ?? []
    list.push(row)
    skillsByProvider.set(row.providerId, list)
  }

  const certsByProvider = new Map<string, typeof certificationRows>()
  for (const row of certificationRows) {
    const list = certsByProvider.get(row.providerId) ?? []
    list.push(row)
    certsByProvider.set(row.providerId, list)
  }

  const areasByProvider = new Map<string, typeof areaRows>()
  for (const row of areaRows) {
    const list = areasByProvider.get(row.providerId) ?? []
    list.push(row)
    areasByProvider.set(row.providerId, list)
  }

  const availabilityByProvider = new Map(
    availabilityRows.map((row: any) => [row.providerId, row]),
  )

  const scheduleItemsByProvider = new Map<string, typeof scheduleItems>()
  for (const row of scheduleItems) {
    const list = scheduleItemsByProvider.get(row.providerId) ?? []
    list.push(row)
    scheduleItemsByProvider.set(row.providerId, list)
  }

  const matchesByProvider = new Map<string, typeof matchRows>()
  for (const row of matchRows) {
    const list = matchesByProvider.get(row.providerId) ?? []
    list.push(row)
    matchesByProvider.set(row.providerId, list)
  }

  const jobsByProvider = new Map<string, typeof activeJobs>()
  for (const row of activeJobs) {
    const list = jobsByProvider.get(row.providerId) ?? []
    list.push(row)
    jobsByProvider.set(row.providerId, list)
  }

  // WS-B.1 ProviderCertification + ProviderEquipment batch fetch
  type AdminCertRow = { providerId: string; name: string; verifiedAt: Date | null; expiresAt: Date | null }
  type AdminEquipRow = { providerId: string; label: string; category: string | null; active: boolean }

  const [adminCertRows, adminEquipRows] = await Promise.all([
    safeOptionalQuery(
      () =>
        (db as any).providerCertification?.findMany?.({
          where: { providerId: { in: providerIds } },
          // expiresAt is required so hasRequiredCertifications can reject expired certs.
          select: { providerId: true, name: true, verifiedAt: true, expiresAt: true },
        }) ?? Promise.resolve([]),
      [] as AdminCertRow[],
    ),
    safeOptionalQuery(
      () =>
        (db as any).providerEquipment?.findMany?.({
          where: { providerId: { in: providerIds }, active: true },
          select: { providerId: true, label: true, category: true, active: true },
        }) ?? Promise.resolve([]),
      [] as AdminEquipRow[],
    ),
  ])

  const adminCertsByProvider = new Map<string, AdminCertRow[]>()
  for (const row of adminCertRows) {
    const list = adminCertsByProvider.get(row.providerId) ?? []
    list.push(row)
    adminCertsByProvider.set(row.providerId, list)
  }

  const adminEquipmentByProvider = new Map<string, AdminEquipRow[]>()
  for (const row of adminEquipRows) {
    const list = adminEquipmentByProvider.get(row.providerId) ?? []
    list.push(row)
    adminEquipmentByProvider.set(row.providerId, list)
  }

  const providers = baseProviders.map((provider) => {
    const hydratedProvider = provider as typeof provider & {
      averageRating?: number
      reliabilityScore?: number
      completedJobsCount?: number
      onTimeRate?: number
      acceptanceRate?: number
      complaintCount?: number
      complaintRate?: number
      providerCancellationCount?: number
      cancellationRate?: number
      lateArrivalCount?: number
      punctualityScore?: number
      maxTravelMinutes?: number
      lastKnownLat?: number | null
      lastKnownLng?: number | null
      lastKnownLocationLabel?: string | null
      lastKnownLocationAt?: Date | null
      equipmentTags?: string[]
      vehicleTypes?: string[]
      technicianSkills?: { skillTag: string }[]
      technicianCertifications?: { certificationCode: string; status: string }[]
      technicianServiceAreas?: {
        label: string
        city?: string | null
        active: boolean
        areaType?: string
        lat?: number | null
        lng?: number | null
        radiusKm?: number | null
        locationNodeId?: string | null
        regionKey?: string | null
      }[]
      technicianAvailability?: {
        availabilityMode: string | null
        availabilityState: string
        nextAvailableAt: Date | null
        breakUntil: Date | null
        emergencyAvailable?: boolean | null
        sameDayAvailable?: boolean | null
      } | null
      schedule?: { dayOfWeek: number; startTime: string; endTime: string; active: boolean }[]
      scheduleItems?: {
        id: string
        itemType: string
        title: string | null
        startAt: Date
        endAt: Date
        bufferBeforeMinutes: number
        bufferAfterMinutes: number
        locationLabel: string | null
        lat: number | null
        lng: number | null
        status: string
      }[]
      matches?: { providerId: string }[]
      jobs?: {
        booking: {
          id: string
          scheduledDate: Date
          scheduledStartAt?: Date | null
          scheduledEndAt?: Date | null
          scheduledWindow: string | null
          status: string
        } | null
      }[]
    }

    return {
      ...provider,
      averageRating: hydratedProvider.averageRating ?? 0,
      reliabilityScore: hydratedProvider.reliabilityScore ?? 0.5,
      completedJobsCount: hydratedProvider.completedJobsCount ?? 0,
      onTimeRate: hydratedProvider.onTimeRate ?? 1,
      acceptanceRate: hydratedProvider.acceptanceRate ?? 1,
      complaintCount: hydratedProvider.complaintCount ?? 0,
      complaintRate: hydratedProvider.complaintRate ?? 0,
      providerCancellationCount: hydratedProvider.providerCancellationCount ?? 0,
      cancellationRate: hydratedProvider.cancellationRate ?? 0,
      lateArrivalCount: hydratedProvider.lateArrivalCount ?? 0,
      punctualityScore: hydratedProvider.punctualityScore ?? 1,
      maxTravelMinutes: hydratedProvider.maxTravelMinutes ?? 90,
      lastKnownLat: hydratedProvider.lastKnownLat ?? null,
      lastKnownLng: hydratedProvider.lastKnownLng ?? null,
      lastKnownLocationLabel: hydratedProvider.lastKnownLocationLabel ?? null,
      lastKnownLocationAt: hydratedProvider.lastKnownLocationAt ?? null,
      equipmentTags: hydratedProvider.equipmentTags ?? [],
      vehicleTypes: hydratedProvider.vehicleTypes ?? [],
      technicianSkills: hydratedProvider.technicianSkills ?? skillsByProvider.get(provider.id) ?? [],
      technicianCertifications: hydratedProvider.technicianCertifications ?? certsByProvider.get(provider.id) ?? [],
      adminCertifications: adminCertsByProvider.get(provider.id) ?? [],
      equipment: adminEquipmentByProvider.get(provider.id) ?? [],
      technicianServiceAreas: hydratedProvider.technicianServiceAreas ?? areasByProvider.get(provider.id) ?? [],
      technicianAvailability: hydratedProvider.technicianAvailability ?? availabilityByProvider.get(provider.id) ?? null,
      schedule: schedulesByProvider.get(provider.id) ?? [],
      scheduleItems: hydratedProvider.scheduleItems ?? scheduleItemsByProvider.get(provider.id) ?? [],
      matches: hydratedProvider.matches ?? matchesByProvider.get(provider.id) ?? [],
      jobs: (hydratedProvider.jobs ?? jobsByProvider.get(provider.id) ?? []).map((job) => {
        const booking = job.booking as
          | {
              id: string
              scheduledDate: Date
              scheduledStartAt?: Date | null
              scheduledEndAt?: Date | null
              scheduledWindow: string | null
              status: string
            }
          | null

        return {
          booking: booking
            ? {
                ...booking,
                scheduledStartAt: booking.scheduledStartAt ?? null,
                scheduledEndAt: booking.scheduledEndAt ?? null,
              }
            : null,
        }
      }),
    }
  })

  return {
    jobRequest: jobRequest as MatchingJobRequest & {
      address: MatchingAddress
      customer: { id: string; name: string; phone: string }
    },
    providers: providers as unknown as (MatchingProvider & {
      schedule: { dayOfWeek: number; startTime: string; endTime: string; active: boolean }[]
      matches: { providerId: string }[]
      jobs: { booking: { id: string; scheduledDate: Date; scheduledStartAt: Date | null; scheduledEndAt: Date | null; scheduledWindow: string | null; status: string } | null }[]
    })[],
  }
}

export async function rankCandidatesForJobRequest(jobRequestId: string): Promise<RankingResult> {
  const { jobRequest, providers } = await loadMatchingContext(jobRequestId)
  const address = jobRequest.address
  const filteredOut: RankingResult['filteredOut'] = []
  const candidates: RankedCandidate[] = []
  const requestWindow = deriveRequestWindow(jobRequest)
  const categoryRequirements = await resolveCategoryRequirements({
    category: jobRequest.category,
    requiredCertificationCodes: jobRequest.requiredCertificationCodes,
    requiredEquipmentTags: jobRequest.requiredEquipmentTags,
    requiredVehicleTypes: jobRequest.requiredVehicleTypes,
  })

  for (const provider of providers) {
    const filteredReasonCodes: string[] = []

    if (!provider.active) filteredReasonCodes.push('TECHNICIAN_INACTIVE')
    if (!provider.availableNow) filteredReasonCodes.push('TECHNICIAN_NOT_AVAILABLE_NOW')
    if (provider.technicianAvailability?.availabilityState === 'OFFLINE') {
      filteredReasonCodes.push('TECHNICIAN_OFFLINE')
    }
    if (
      provider.technicianAvailability?.availabilityState === 'PAUSED' ||
      provider.technicianAvailability?.availabilityMode === 'PAUSED'
    ) {
      filteredReasonCodes.push('TECHNICIAN_PAUSED')
    }
    if (provider.technicianAvailability?.breakUntil && provider.technicianAvailability.breakUntil > new Date()) {
      filteredReasonCodes.push('TECHNICIAN_TEMP_PAUSED')
    }
    if (
      provider.technicianAvailability?.sameDayAvailable === false &&
      isSameCalendarDay(requestWindow.startAt, new Date())
    ) {
      filteredReasonCodes.push('SAME_DAY_NOT_AVAILABLE')
    }
    if (
      provider.technicianAvailability?.emergencyAvailable === false &&
      isOutsideStandardLeadHours(requestWindow.startAt)
    ) {
      filteredReasonCodes.push('EMERGENCY_NOT_AVAILABLE')
    }
    const areaCoverage = providerCoversAddress(provider, address)
    if (!areaCoverage.covers) {
      filteredReasonCodes.push('OUTSIDE_SERVICE_AREA')
    }
    if (!hasRequiredSkills(jobRequest, provider)) {
      filteredReasonCodes.push('MISSING_REQUIRED_SKILL')
    }
    const missingCertifications = getMissingRequiredCertifications(categoryRequirements, provider)
    filteredReasonCodes.push(
      ...missingCertifications.map((code) => `MISSING_REQUIRED_CERTIFICATION:${code}`),
    )

    const missingEquipmentTags = getMissingRequiredEquipmentTags(categoryRequirements, provider)
    filteredReasonCodes.push(
      ...missingEquipmentTags.map((tag) => `MISSING_REQUIRED_EQUIPMENT:${tag}`),
    )
    if (!hasRequiredVehicleTypes(categoryRequirements, provider)) {
      filteredReasonCodes.push('MISSING_REQUIRED_VEHICLE')
    }

    const usesSchedule = provider.technicianAvailability?.availabilityMode === 'SCHEDULE'
    const scheduleRule = usesSchedule
      ? provider.schedule.find((rule) => rule.dayOfWeek === requestWindow.startAt.getDay()) ?? null
      : null

    const workingWindow = buildWorkingWindow({
      requestStartAt: requestWindow.startAt,
      schedule: scheduleRule,
    })

    const commitments = normalizeCommitments({
      bookings: provider.jobs
        .map((job) => job.booking)
        .filter((booking): booking is NonNullable<typeof booking> => Boolean(booking))
        .map((booking) => ({
          ...booking,
          status: booking.status as BookingStatus,
        })),
      scheduleItems: provider.scheduleItems,
    })

    const scheduleFit = evaluateScheduleFit({
      jobRequest,
      requestAddress: address,
      workingWindow,
      technicianAvailability: provider.technicianAvailability,
      commitments,
      technicianOrigin: {
        suburb: provider.technicianServiceAreas.find((area) => area.active)?.label ??
          provider.serviceAreas[0] ??
          null,
        city: provider.technicianServiceAreas.find((area) => area.city)?.city ?? address.city,
        lat: provider.lastKnownLat,
        lng: provider.lastKnownLng,
      },
      maxTravelMinutes: provider.maxTravelMinutes,
    })

    if (!scheduleFit.isAvailable) {
      filteredReasonCodes.push(
        scheduleFit.canMeetWindow ? 'SCHEDULE_CONFLICT' : 'WINDOW_NOT_FEASIBLE',
      )
    }

    if (filteredReasonCodes.length > 0) {
      filteredOut.push({
        providerId: provider.id,
        providerName: provider.name,
        filteredReasonCodes,
        coverageTier: areaCoverage.tier,
      })
      continue
    }

    const scoreBreakdown = buildScoreBreakdown({
      jobRequest,
      provider,
      scheduleFitScore: scheduleFit.score,
      travelMinutes: scheduleFit.travelMinutes,
      canMeetWindow: scheduleFit.canMeetWindow,
      coverageTier: areaCoverage.tier,
      categoryPolicy: categoryRequirements.policy,
    })

    candidates.push({
      providerId: provider.id,
      providerName: provider.name,
      score: scoreBreakdown.total,
      scoreBreakdown,
      filteredReasonCodes,
      feasibilityNotes: provider.verified
        ? scheduleFit.notes
        : [...scheduleFit.notes, 'Profile is still pending marketplace review'],
      travelMinutes: scheduleFit.travelMinutes,
      availabilityState:
        provider.technicianAvailability?.availabilityState ??
        (provider.availableNow ? 'AVAILABLE' : 'PAUSED'),
      canMeetWindow: scheduleFit.canMeetWindow,
      estimatedStartAt: scheduleFit.estimatedStartAt,
      estimatedEndAt: scheduleFit.estimatedEndAt,
      reliabilityIndicators: {
        reliabilityScore: provider.reliabilityScore,
        averageRating: provider.averageRating,
        completedJobsCount: provider.completedJobsCount,
        onTimeRate: provider.onTimeRate,
        acceptanceRate: provider.acceptanceRate,
        complaintRate: provider.complaintRate,
        cancellationRate: provider.cancellationRate,
        punctualityScore: provider.punctualityScore,
      },
      selectionReason: scoreBreakdown.reasons[0] ?? 'Best overall operational fit',
    })
  }

  candidates.sort((a, b) => b.score - a.score || a.travelMinutes - b.travelMinutes)

  return {
    jobRequestId,
    assignmentMode: jobRequest.assignmentMode,
    consideredCount: providers.length,
    eligibleCount: candidates.length,
    filteredOut,
    candidates,
  }
}

async function persistDispatchDecision(params: {
  ranking: RankingResult
  actor: DispatchActor
  mode: AssignmentMode | 'MANUAL_OVERRIDE'
  idempotencyKey?: string
  overrideProviderId?: string
  overrideReason?: string | null
}) {
  const decisionMode =
    params.mode === 'MANUAL_OVERRIDE' ? 'MANUAL_OVERRIDE' : params.mode
  const status =
    params.ranking.candidates.length === 0 ? 'NO_MATCH' : params.mode === 'OPS_REVIEW' ? 'RANKED' : 'OFFERING'

  const rankingSummary = params.ranking.candidates.map((candidate, index) => ({
    providerId: candidate.providerId,
    score: candidate.score,
    rankedPosition: index + 1,
    selectionReason: candidate.selectionReason,
    travelMinutes: candidate.travelMinutes,
    canMeetWindow: candidate.canMeetWindow,
  }))

  const filterSummary = params.ranking.filteredOut

  const decision = await db.dispatchDecision.create({
    data: {
      jobRequestId: params.ranking.jobRequestId,
      mode: decisionMode,
      status,
      initiatedById: params.actor.actorId,
      initiatedByRole: params.actor.actorRole,
      idempotencyKey: params.idempotencyKey,
      selectedProviderId: params.overrideProviderId,
      overrideReason: params.overrideReason ?? undefined,
      consideredCount: params.ranking.consideredCount,
      eligibleCount: params.ranking.eligibleCount,
      scoreWeights: MATCHING_CONFIG.weights as Prisma.InputJsonValue,
      rankingSummary: rankingSummary as Prisma.InputJsonValue,
      filterSummary: filterSummary as Prisma.InputJsonValue,
      explanation:
        params.ranking.candidates[0]?.selectionReason ??
        'No eligible technicians passed the matching filters',
    },
  })

  for (const [index, candidate] of params.ranking.candidates.entries()) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: params.ranking.jobRequestId,
        providerId: candidate.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: index + 1,
        rankedPosition: index + 1,
        stage: 'RANKED',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: candidate.feasibilityNotes,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown as Prisma.InputJsonValue,
      },
    })
  }

  for (const filtered of params.ranking.filteredOut) {
    await db.matchAttempt.create({
      data: {
        jobRequestId: params.ranking.jobRequestId,
        providerId: filtered.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: 0,
        stage: 'FILTERED_OUT',
        hardFilterPassed: false,
        filteredReasonCodes: filtered.filteredReasonCodes,
        feasibilityNotes: [],
      },
    })
  }

  await db.jobRequest.update({
    where: { id: params.ranking.jobRequestId },
    data: {
      latestDispatchDecisionId: decision.id,
      assignmentMode: params.mode === 'MANUAL_OVERRIDE' ? 'OPS_REVIEW' : params.mode,
      status: params.ranking.candidates.length > 0 ? 'MATCHING' : 'OPEN',
    },
  })

  return decision
}

async function createOfferForAttempt(params: {
  dispatchDecisionId: string
  jobRequestId: string
  matchAttemptId: string
  providerId: string
  actor: DispatchActor
}) {
  const expiresAt = new Date(Date.now() + MATCHING_CONFIG.offerTtlMinutes * 60_000)

  await db.assignmentHold.updateMany({
    where: {
      jobRequestId: params.jobRequestId,
      status: 'ACTIVE',
    },
    data: {
      status: 'RELEASED',
      releasedAt: new Date(),
      outcomeReasonCode: 'SUPERSEDED_BY_NEW_OFFER',
    },
  })

  await releaseAssignmentHoldScheduleItems(db, {
    jobRequestId: params.jobRequestId,
    itemType: 'ASSIGNMENT_HOLD',
    status: 'ACTIVE',
  })

  const hold = await db.assignmentHold.create({
    data: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      status: 'ACTIVE',
      expiresAt,
    },
  })

  const jobRequest = await loadMatchingJobRequest(db, params.jobRequestId)

  // Guard: do not re-activate a lead that the provider has already explicitly declined
  const existingLeadForGuard = await db.lead.findUnique({
    where: { jobRequestId_providerId: { jobRequestId: params.jobRequestId, providerId: params.providerId } },
    select: { id: true, status: true },
  })
  if (existingLeadForGuard?.status === 'DECLINED') {
    throw Object.assign(
      new Error('PROVIDER_PREVIOUSLY_DECLINED'),
      { code: 'PROVIDER_PREVIOUSLY_DECLINED', jobRequestId: params.jobRequestId, providerId: params.providerId }
    )
  }

  const lead = await db.lead.upsert({
    where: {
      jobRequestId_providerId: {
        jobRequestId: params.jobRequestId,
        providerId: params.providerId,
      },
    },
    create: {
      jobRequestId: params.jobRequestId,
      providerId: params.providerId,
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      assignmentHoldId: hold.id,
      status: 'SENT',
      isTestLead: jobRequest.isTestRequest,
      cohortName: jobRequest.cohortName,
      expiresAt,
    },
    update: {
      dispatchDecisionId: params.dispatchDecisionId,
      matchAttemptId: params.matchAttemptId,
      assignmentHoldId: hold.id,
      status: 'SENT',
      isTestLead: jobRequest.isTestRequest,
      cohortName: jobRequest.cohortName,
      sentAt: new Date(),
      respondedAt: null,
      expiresAt,
    },
  })

  await db.matchAttempt.update({
    where: { id: params.matchAttemptId },
    data: {
      stage: 'OFFERED',
      offeredAt: new Date(),
      reasonCode: 'TOP_RANKED_ACTIVE_OFFER',
    },
  })

  await db.dispatchDecision.update({
    where: { id: params.dispatchDecisionId },
    data: {
      status: 'OFFERING',
      selectedProviderId: params.providerId,
      selectedMatchAttemptId: params.matchAttemptId,
      nextRetryAt: expiresAt,
    },
  })

  const requestWindow = deriveRequestWindow(jobRequest)
  await createAssignmentHoldScheduleItem(db, {
    providerId: params.providerId,
    jobRequestId: params.jobRequestId,
    assignmentHoldId: hold.id,
    itemType: 'ASSIGNMENT_HOLD',
    status: 'ACTIVE',
    title: `${jobRequest.category} offer hold`,
    startAt: requestWindow.startAt,
    endAt: requestWindow.endAt,
    source: 'matching_engine',
    locationLabel: [
      normaliseLocationDisplayName(jobRequest.address?.suburb),
      normaliseLocationDisplayName(jobRequest.address?.city),
    ].filter(Boolean).join(', '),
    lat: jobRequest.address?.lat ?? undefined,
    lng: jobRequest.address?.lng ?? undefined,
  })

  const provider = await loadProviderOfferContact(db, params.providerId)

  const { notifyProviderNewJob } = await import('../whatsapp-bot')
  let interactiveDelivered = false
  await notifyProviderNewJob({
    providerPhone: provider.phone,
    leadId: lead.id,
    category: jobRequest.category,
    area: normaliseLocationDisplayName(jobRequest.address?.suburb) || normaliseLocationDisplayName(jobRequest.address?.city),
    isTestLead: jobRequest.isTestRequest,
    description: jobRequest.title || jobRequest.description || jobRequest.category,
    customerInitial: (jobRequest.customer?.name ?? 'Customer').split(' ')[0] ?? 'Customer',
    expiresInMinutes: MATCHING_CONFIG.offerTtlMinutes,
  }).then(() => {
    interactiveDelivered = true
  }).catch((error) => {
    console.error('[matching] Failed to notify provider of assignment offer:', error)
  })

  // Template fallback - only fires when the interactive CTA message fails (e.g. provider outside 24h session window).
  // Sending both would duplicate the notification; the interactive message is always preferred.
  if (!interactiveDelivered) {
    const [{ sendJobOffer }, { getProviderLeadAccessUrl }] = await Promise.all([
      import('../whatsapp'),
      import('../provider-lead-access'),
    ])
    const scheduledWindow = requestWindow.startAt.toLocaleDateString('en-ZA', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
    const signedUrl = await getProviderLeadAccessUrl({ leadId: lead.id, providerId: params.providerId })
    if (!signedUrl) {
      console.error('[matching] Skipping job_offer template - no signed lead URL available', { leadId: lead.id })
    } else {
      sendJobOffer({
        providerPhone: provider.phone,
        providerFirstName: provider.name.split(' ')[0] ?? provider.name,
        serviceName: jobRequest.category,
        area: normaliseLocationDisplayName(jobRequest.address?.suburb) || normaliseLocationDisplayName(jobRequest.address?.city),
        scheduledWindow,
        jobUrl: signedUrl,
      }).catch((error) => {
        console.error('[matching] Failed to send job_offer template to provider:', error)
      })
    }
  }

  // Quick-response action buttons - same credit copy and Accept Lead / Decline
  // buttons as the dispatch.ts path so providers always see a consistent UI.
  if (interactiveDelivered) {
    const { sendButtons } = await import('../whatsapp-interactive')
    const { getProviderWalletBalanceReadOnly } = await import('../provider-wallet')
    const suburb = normaliseLocationDisplayName(jobRequest.address?.suburb) || 'your area'
    const category = jobRequest.category
    const balance = await getProviderWalletBalanceReadOnly(params.providerId)
    const actionsBody = buildProviderLeadActionsMessage({ category, area: suburb, balance })
    await sendButtons(
      provider.phone,
      actionsBody,
      [
        { id: `accept:${hold.id}`, title: 'Accept Lead' },
        { id: `decline:${hold.id}`, title: 'Decline' },
      ],
      undefined,
      {
        templateName: 'interactive:new_lead_actions',
        metadata: { jobRequestId: jobRequest.id, leadId: lead.id, holdId: hold.id, providerId: params.providerId },
      }
    ).catch((error) => {
      console.error('[matching] Failed to send lead action buttons to provider:', error)
    })
  }

  return { hold, lead }
}

export async function runAssignmentForJobRequest(params: {
  jobRequestId: string
  actor?: DispatchActor
  mode?: AssignmentMode
}) : Promise<DispatchRunResult> {
  const actor = params.actor ?? { actorId: 'system', actorRole: 'system' as const }
  const jobRequestForKey = await loadMatchingJobRequest(db, params.jobRequestId)
  const mode = params.mode ?? jobRequestForKey.assignmentMode
  const idempotencyKey = buildDispatchIdempotencyKey({
    jobRequest: jobRequestForKey,
    mode,
  })
  const ranking = await rankCandidatesForJobRequest(params.jobRequestId)
  const existingMatch = await db.match.findUnique({
    where: { jobRequestId: params.jobRequestId },
  })

  if (existingMatch) {
    return {
      ...ranking,
      dispatchDecisionId: 'existing-match',
      status: 'ASSIGNED',
      offeredProviderId: existingMatch.providerId,
      assignmentHoldId: null,
    }
  }

  const activeHold = await db.assignmentHold.findFirst({
    where: {
      jobRequestId: params.jobRequestId,
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
  })

  if (activeHold) {
    const activeDecision = await db.dispatchDecision.findUnique({
      where: { id: activeHold.dispatchDecisionId },
    })

    return {
      ...ranking,
      dispatchDecisionId: activeHold.dispatchDecisionId,
      status: activeDecision?.status ?? 'OFFERING',
      offeredProviderId: activeHold.providerId,
      assignmentHoldId: activeHold.id,
    }
  }

  const existingDecision = await db.dispatchDecision.findFirst({
    where: {
      jobRequestId: params.jobRequestId,
      idempotencyKey,
      status: mode === 'OPS_REVIEW' ? 'RANKED' : { in: ['RANKED', 'OFFERING'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existingDecision && mode === 'OPS_REVIEW') {
    return {
      ...ranking,
      dispatchDecisionId: existingDecision.id,
      status: existingDecision.status,
      offeredProviderId: existingDecision.selectedProviderId,
      assignmentHoldId: null,
    }
  }

  const dispatchDecision = await persistDispatchDecision({
    ranking,
    actor,
    mode,
    idempotencyKey,
  })

  if (mode === 'OPS_REVIEW' || ranking.candidates.length === 0) {
    return {
      ...ranking,
      dispatchDecisionId: dispatchDecision.id,
      status: dispatchDecision.status,
      offeredProviderId: null,
      assignmentHoldId: null,
    }
  }

  const topCandidate = ranking.candidates[0]
  const topAttempt = await db.matchAttempt.findFirstOrThrow({
    where: {
      dispatchDecisionId: dispatchDecision.id,
      providerId: topCandidate.providerId,
    },
  })
  const offer = await createOfferForAttempt({
    dispatchDecisionId: dispatchDecision.id,
    jobRequestId: ranking.jobRequestId,
    matchAttemptId: topAttempt.id,
    providerId: topCandidate.providerId,
    actor,
  })

  return {
    ...ranking,
    dispatchDecisionId: dispatchDecision.id,
    status: 'OFFERING',
    offeredProviderId: topCandidate.providerId,
    assignmentHoldId: offer.hold.id,
  }
}

type RotationEligibilityResult =
  | { ok: true }
  | { ok: false; reason: 'PROVIDER_LOCKED' | 'ALREADY_HELD' | 'AT_CAPACITY' | 'JOB_NO_LONGER_OPEN' | 'TRANSACTION_FAILED' }

/**
 * Atomically re-applies the same eligibility gate as reserveBestProviderAtomically()
 * before a rotated Quick Match offer is created. The first offer in a Quick Match
 * queue passes through reserveBestProviderAtomically(); rotated offers (after a
 * decline/timeout) previously skipped these checks and could leak a signed lead +
 * safe-preview job details to a provider who had since become unavailable, was
 * already holding another job, was over capacity, or whose job was no longer OPEN.
 *
 * On success the provider's activeHolds counter is incremented inside the same
 * transaction so capacity accounting stays consistent with the reservation path.
 * Callers MUST release the capacity (releaseProviderCapacity) if the subsequent
 * offer write fails, mirroring reserveBestProviderAtomically's contract.
 */
async function reserveRotationCandidateAtomically(params: {
  jobRequestId: string
  providerId: string
}): Promise<RotationEligibilityResult> {
  try {
    const result = await db.$transaction(
      async (tx) => {
        // 1. Lock the provider row (SKIP LOCKED = fail fast, don't queue)
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "providers"
          WHERE id = ${params.providerId}
            AND active = true
          FOR UPDATE SKIP LOCKED
        `
        if (locked.length === 0) return { reason: 'PROVIDER_LOCKED' as const }

        // 2. No active hold created since the queue was ranked
        const existingHold = await tx.assignmentHold.findFirst({
          where: {
            providerId: params.providerId,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        })
        if (existingHold) return { reason: 'ALREADY_HELD' as const }

        // 3. Capacity guard
        const capacity = await tx.providerCapacity.findUnique({
          where: { providerId: params.providerId },
          select: { activeHolds: true, maxConcurrent: true },
        })
        if (capacity && capacity.activeHolds >= capacity.maxConcurrent) {
          return { reason: 'AT_CAPACITY' as const }
        }

        // 4. Job must still be open for matching (OPEN or MATCHING - the rotation
        //    runs after a prior hold released, where the job sits in MATCHING).
        const job = await tx.jobRequest.findUnique({
          where: { id: params.jobRequestId },
          select: { status: true },
        })
        if (job?.status !== 'OPEN' && job?.status !== 'MATCHING') {
          return { reason: 'JOB_NO_LONGER_OPEN' as const }
        }

        // 5. Reserve capacity in the same transaction as the eligibility checks.
        await tx.providerCapacity.upsert({
          where: { providerId: params.providerId },
          create: { providerId: params.providerId, activeHolds: 1, activeJobs: 0, maxConcurrent: 2 },
          update: { activeHolds: { increment: 1 }, updatedAt: new Date() },
        })

        return { ok: true as const }
      },
      { timeout: 5_000, isolationLevel: 'ReadCommitted' }
    )

    if ('ok' in result && result.ok) return { ok: true }
    if ('reason' in result) return { ok: false, reason: result.reason }
    return { ok: false, reason: 'TRANSACTION_FAILED' }
  } catch (err) {
    console.error('[reserveRotationCandidateAtomically] transaction failed', {
      providerId: params.providerId,
      jobRequestId: params.jobRequestId,
      err,
    })
    return { ok: false, reason: 'TRANSACTION_FAILED' }
  }
}

async function offerNextRankedCandidate(params: {
  jobRequestId: string
  dispatchDecisionId: string
  actor?: DispatchActor
}) {
  const attempts = await db.matchAttempt.findMany({
    where: {
      dispatchDecisionId: params.dispatchDecisionId,
      hardFilterPassed: true,
    },
    orderBy: { rankedPosition: 'asc' },
  })

  const rankedAttempts = attempts.filter((attempt) => attempt.stage === 'RANKED')

  // Walk the remaining ranked queue, skipping any candidate that no longer
  // passes the reservation eligibility gate. Rotated offers must enforce the
  // SAME checks as the first offer (provider lock / active holds / capacity /
  // job still open) so a provider who became ineligible after the queue was
  // built never receives a signed lead or safe-preview job details.
  for (const nextAttempt of rankedAttempts) {
    const eligibility = await reserveRotationCandidateAtomically({
      jobRequestId: params.jobRequestId,
      providerId: nextAttempt.providerId,
    })

    if (!eligibility.ok) {
      await db.matchAttempt.update({
        where: { id: nextAttempt.id },
        data: { stage: 'SKIPPED', reasonCode: eligibility.reason },
      }).catch((err) =>
        console.error('[offerNextRankedCandidate] failed to mark skipped attempt', {
          jobRequestId: params.jobRequestId,
          providerId: nextAttempt.providerId,
          matchAttemptId: nextAttempt.id,
          err,
        })
      )
      emitMatchEvent({
        event: 'reservation.failed',
        jobRequestId: params.jobRequestId,
        providerId: nextAttempt.providerId,
        reason: eligibility.reason,
      })
      // JOB_NO_LONGER_OPEN means the whole request moved on (assigned/cancelled/
      // expired) - stop rotating immediately rather than offering later candidates.
      if (eligibility.reason === 'JOB_NO_LONGER_OPEN') break
      continue
    }

    await db.dispatchDecision.update({
      where: { id: params.dispatchDecisionId },
      data: {
        retryCount: { increment: 1 },
        nextRetryAt: new Date(Date.now() + MATCHING_CONFIG.retryDelayMinutes * 60_000),
      },
    })

    try {
      const offer = await createOfferForAttempt({
        dispatchDecisionId: params.dispatchDecisionId,
        jobRequestId: params.jobRequestId,
        matchAttemptId: nextAttempt.id,
        providerId: nextAttempt.providerId,
        actor: params.actor ?? { actorId: 'system', actorRole: 'system' },
      })

      return {
        nextOfferedProviderId: nextAttempt.providerId,
        assignmentHoldId: offer.hold.id,
      }
    } catch (err) {
      // The eligibility gate already incremented the capacity counter; release it
      // so a failed offer does not permanently consume the provider's capacity.
      await releaseProviderCapacity(nextAttempt.providerId).catch(() => undefined)
      await db.matchAttempt.update({
        where: { id: nextAttempt.id },
        data: { stage: 'SKIPPED', reasonCode: 'OFFER_CREATE_FAILED' },
      }).catch(() => undefined)
      console.error('[offerNextRankedCandidate] createOfferForAttempt failed - rotating to next candidate', {
        jobRequestId: params.jobRequestId,
        providerId: nextAttempt.providerId,
        matchAttemptId: nextAttempt.id,
        err,
      })
      // PROVIDER_PREVIOUSLY_DECLINED and similar guards throw - continue rotation.
      continue
    }
  }

  // No eligible ranked candidate remained - terminate the request instead of
  // reopening it for a fresh ranking loop. Use expireOpenJobRequest for guarded expiry.
  await db.dispatchDecision.update({
    where: { id: params.dispatchDecisionId },
    data: { status: 'NO_MATCH', nextRetryAt: null },
  })
  const { transitioned } = await expireOpenJobRequest(
    params.jobRequestId,
    'quick_match_queue_exhausted',
  )
  console.info('[offerNextRankedCandidate] queue exhausted', {
    jobRequestId: params.jobRequestId,
    dispatchDecisionId: params.dispatchDecisionId,
    transitioned,
  })
  return { nextOfferedProviderId: null, assignmentHoldId: null }
}

export async function acceptAssignmentOffer(params: {
  leadId: string
  providerId: string
  inspectionNeeded?: boolean
  source?: 'whatsapp' | 'pwa' | 'api'
}): Promise<OfferResolutionResult> {
  const acceptStart = Date.now()
  const traceId = createTraceId(params.source ?? 'api')
  let transactionResult

  try {
    transactionResult = await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: params.leadId },
      include: {
        assignmentHold: true,
        matchAttempt: true,
      },
    })

      if (!lead) return { ok: false as const, reason: 'NOT_FOUND' }
      if (lead.providerId !== params.providerId) return { ok: false as const, reason: 'FORBIDDEN' }

      const provider = await tx.provider.findUnique({
        where: { id: params.providerId },
        select: {
          id: true,
          active: true,
          verified: true,
          status: true,
        },
      })
      if (!provider) return { ok: false as const, reason: 'FORBIDDEN' }
      if (!provider.active || !provider.verified || provider.status !== 'ACTIVE') {
        console.warn('[matching] provider blocked from accepting lead because profile is not approved', {
          trace_id: traceId,
          provider_id: params.providerId,
          lead_id: params.leadId,
          provider_active: provider.active,
          provider_verified: provider.verified,
          provider_status: provider.status,
        })
        return { ok: false as const, reason: 'PROVIDER_NOT_APPROVED' }
      }

      const existingMatch = await tx.match.findUnique({
        where: { jobRequestId: lead.jobRequestId },
      })
      const walletBefore = await tx.providerWallet.findUnique({
        where: { providerId: params.providerId },
        select: { paidCreditBalance: true, promoCreditBalance: true },
      })
      const currentCreditBalance =
        (walletBefore?.paidCreditBalance ?? 0) + (walletBefore?.promoCreditBalance ?? 0)

      if (
        existingMatch?.providerId === params.providerId &&
        (lead.status === 'ACCEPTED' || lead.assignmentHold?.status === 'ACCEPTED')
      ) {
        await tx.lead.updateMany({
          where: { id: lead.id, status: { not: 'ACCEPTED' } },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        })
        if (lead.assignmentHoldId) {
          await tx.assignmentHold.updateMany({
            where: { id: lead.assignmentHoldId, status: { not: 'ACCEPTED' } },
            data: {
              status: 'ACCEPTED',
              respondedAt: new Date(),
              releasedAt: new Date(),
              outcomeReasonCode: 'DUPLICATE_ACCEPT_IGNORED',
            },
          })
        }

        return {
          ok: true as const,
          responseOutcome: 'ACCEPTED',
          matchId: existingMatch.id,
          jobRequestId: lead.jobRequestId,
          bookingId: null,
          assignmentHoldId: lead.assignmentHoldId ?? 'already-accepted',
          nextOfferedProviderId: null,
          alreadyUnlocked: true,
          creditTransactionId: null,
          currentCreditBalance,
          leadStatusBefore: lead.status,
          leadStatusAfter: 'ACCEPTED',
        }
      }

      if (!lead.assignmentHoldId || !lead.assignmentHold) {
        return { ok: false as const, reason: existingMatch ? 'TAKEN' : 'NOT_FOUND' }
      }
      if (lead.assignmentHold.status !== 'ACTIVE') {
        return { ok: false as const, reason: 'TAKEN' }
      }
      if (lead.expiresAt && lead.expiresAt < new Date()) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'EXPIRED', respondedAt: new Date() },
        })
        await tx.assignmentHold.update({
          where: { id: lead.assignmentHold.id },
          data: {
            status: 'EXPIRED',
            respondedAt: new Date(),
            releasedAt: new Date(),
            outcomeReasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
          },
        })
        if (lead.matchAttemptId) {
          await tx.matchAttempt.update({
            where: { id: lead.matchAttemptId },
            data: {
              stage: 'TIMED_OUT',
              respondedAt: new Date(),
              responseOutcome: 'TIMED_OUT',
              reasonCode: 'OFFER_EXPIRED_BEFORE_ACCEPT',
            },
          }).catch(() => {})
        }
        return { ok: false as const, reason: 'EXPIRED' }
      }

      if (existingMatch && existingMatch.providerId !== params.providerId) {
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'EXPIRED', respondedAt: new Date() },
        })
        await tx.assignmentHold.update({
          where: { id: lead.assignmentHold.id },
          data: {
            status: 'RELEASED',
            respondedAt: new Date(),
            releasedAt: new Date(),
            outcomeReasonCode: 'MATCH_ALREADY_TAKEN',
          },
        })
        return { ok: false as const, reason: 'TAKEN' }
      }

    const unlockResult = await unlockLeadForProviderInTransaction(tx, lead.id, params.providerId, {
      source: params.source ?? 'api',
      traceId,
      idempotencyKey: `${params.source ?? 'api'}:${params.providerId}:${lead.id}:unlock_accept_lead`,
      // acceptAssignmentOffer is only invoked from explicit provider accept actions
      // (the "Confirm accept" tap on the lead page or the WhatsApp accept button),
      // never from a bare lead-link page load - so the credit spend is confirmed.
      confirmed: true,
    })
    const alreadyUnlocked = unlockResult.alreadyUnlocked
    const remainingCreditBalance = remainingBalanceFromUnlock(
      unlockResult.ledgerEntries,
      currentCreditBalance,
    )

    if (existingMatch && existingMatch.providerId === params.providerId) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      })
      await tx.assignmentHold.update({
        where: { id: lead.assignmentHold.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
          releasedAt: new Date(),
          outcomeReasonCode: 'MATCH_ALREADY_CONFIRMED',
        },
      })

      return {
        ok: true as const,
        responseOutcome: 'ACCEPTED',
        matchId: existingMatch.id,
        bookingId: null,
        assignmentHoldId: lead.assignmentHold.id,
        nextOfferedProviderId: null,
        alreadyUnlocked,
        creditTransactionId: unlockResult.ledgerEntries.at(-1)?.id ?? null,
        currentCreditBalance: remainingCreditBalance,
        leadStatusBefore: lead.status,
        leadStatusAfter: 'ACCEPTED',
      }
    }

    const jobRequest = await loadMatchingJobRequest(tx, lead.jobRequestId)

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    })
    await tx.assignmentHold.update({
      where: { id: lead.assignmentHold.id },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: 'ACCEPTED',
      },
    })
    if (lead.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId },
        data: {
          stage: 'ACCEPTED',
          respondedAt: new Date(),
          responseOutcome: 'ACCEPTED',
          reasonCode: 'TECHNICIAN_ACCEPTED_OFFER',
        },
      })
    }

    const match = await tx.match.create({
      data: {
        jobRequestId: lead.jobRequestId,
        providerId: params.providerId,
        status: params.inspectionNeeded ? 'INSPECTION_SCHEDULED' : 'MATCHED',
        inspectionNeeded: params.inspectionNeeded === true,
      },
    })

    await tx.auditLog.create({
      data: {
        actorId: params.providerId,
        actorRole: 'provider',
        action: 'lead.accept',
        entityType: 'Lead',
        entityId: lead.id,
        before: {
          status: lead.status,
          jobRequestId: lead.jobRequestId,
        },
        after: {
          status: 'ACCEPTED',
          matchId: match.id,
          leadUnlockId: unlockResult.unlock.id,
          source: params.source ?? 'api',
        },
      },
    })

    await tx.jobRequest.update({
      where: { id: lead.jobRequestId },
      data: { status: 'MATCHED' },
    })

    if (lead.dispatchDecisionId) {
      await tx.dispatchDecision.updateMany({
        where: { id: lead.dispatchDecisionId },
        data: {
          status: 'ASSIGNED',
          selectedProviderId: params.providerId,
          selectedMatchAttemptId: lead.matchAttemptId ?? undefined,
        },
      })
    }

    await tx.lead.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.id },
        status: { in: ['SENT', 'VIEWED'] },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })
    await tx.assignmentHold.updateMany({
      where: {
        jobRequestId: lead.jobRequestId,
        id: { not: lead.assignmentHold.id },
        status: 'ACTIVE',
      },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        outcomeReasonCode: 'MATCH_ASSIGNED_ELSEWHERE',
      },
    })
    await releaseAssignmentHoldScheduleItems(tx, {
      jobRequestId: lead.jobRequestId,
      itemType: 'ASSIGNMENT_HOLD',
      assignmentHoldId: { not: lead.assignmentHold.id },
    })

    let bookingId: string | null = null
    let paymentAmount: number | null = null
    if (
      jobRequest.autoCreateBookingOnAssignment &&
      jobRequest.customerAcceptedAmount != null
    ) {
      const requestWindow = deriveRequestWindow(jobRequest)
      const autoQuote = await tx.quote.create({
        data: {
          matchId: match.id,
          amount: jobRequest.customerAcceptedAmount,
          labourCost: jobRequest.customerAcceptedAmount,
          materialsCost: 0,
          estimatedHours:
            (jobRequest.estimatedDurationMinutes ?? MATCHING_CONFIG.defaultDurationMinutes) / 60,
          description:
            jobRequest.customerAcceptedScope ||
            jobRequest.description ||
            `Customer-approved ${jobRequest.category} scope`,
          preferredDate: requestWindow.startAt,
          approvalToken: crypto.randomUUID(),
          status: 'APPROVED',
          approvedAt: new Date(),
          notes: 'Auto-approved from customer accepted amount at assignment acceptance',
        },
      })

      await tx.match.update({
        where: { id: match.id },
        data: { status: 'QUOTE_APPROVED' },
      })

      const booking = await createBookingArtifactsForApprovedQuote(tx, {
        quoteId: autoQuote.id,
        matchId: match.id,
        providerId: params.providerId,
        category: jobRequest.category,
        jobRequestId: jobRequest.id,
        address: jobRequest.address,
        scheduledDate: requestWindow.startAt,
        estimatedDurationMinutes: jobRequest.estimatedDurationMinutes,
        isTestJob: jobRequest.isTestRequest,
        cohortName: jobRequest.cohortName,
        source: 'assignment_acceptance',
      })

      bookingId = booking.bookingId
      paymentAmount = Number(jobRequest.customerAcceptedAmount)
    }

    return {
      ok: true as const,
      responseOutcome: 'ACCEPTED',
      matchId: match.id,
      jobRequestId: lead.jobRequestId,
      bookingId,
      paymentAmount,
      customerPhone: jobRequest.customer.phone,
      category: jobRequest.category,
      assignmentHoldId: lead.assignmentHold.id,
      nextOfferedProviderId: null,
      alreadyUnlocked,
      creditTransactionId: unlockResult.ledgerEntries.at(-1)?.id ?? null,
      currentCreditBalance: remainingCreditBalance,
      leadStatusBefore: lead.status,
      leadStatusAfter: 'ACCEPTED',
    }
    }, {
      maxWait: ACCEPT_ASSIGNMENT_TRANSACTION_MAX_WAIT_MS,
      timeout: ACCEPT_ASSIGNMENT_TRANSACTION_TIMEOUT_MS,
    })
  } catch (error) {
    if (error instanceof LeadUnlockError) {
      const reason = error.code === 'LEAD_NOT_AVAILABLE'
        ? 'EXPIRED'
        : error.code === 'INSUFFICIENT_CREDITS'
          ? 'INSUFFICIENT_CREDITS'
          : error.code === 'PROVIDER_NOT_APPROVED' || error.code === 'PROVIDER_NOT_ACTIVE' || error.code === 'KYC_REQUIRED'
            ? 'PROVIDER_NOT_APPROVED'
            : error.code === 'WALLET_SUSPENDED'
              ? 'WALLET_SUSPENDED'
              : error.code === 'CONCURRENT_UNLOCK'
                ? 'CONCURRENT_UNLOCK'
                : error.code === 'FORBIDDEN' || error.code === 'CONFIRMATION_REQUIRED'
                  ? 'FORBIDDEN'
                  : 'TAKEN'
      console.info('[matching] lead unlock/accept blocked', {
        provider_id: params.providerId,
        lead_id: params.leadId,
        source: params.source ?? 'api',
        current_credit_balance: error.currentCreditBalance,
        already_unlocked: false,
        result: reason,
        trace_id: traceId,
      })
      return {
        ok: false,
        reason,
        currentCreditBalance: error.currentCreditBalance,
        traceId,
      }
    }

    if (errorCode(error) === 'P2002') {
      console.info('[matching] lead unlock/accept blocked by concurrent match', {
        provider_id: params.providerId,
        lead_id: params.leadId,
        source: params.source ?? 'api',
        result: 'TAKEN',
        trace_id: traceId,
      })
      return { ok: false, reason: 'TAKEN', traceId }
    }

    console.error('[matching] lead unlock/accept failed unexpectedly', {
      provider_id: params.providerId,
      lead_id: params.leadId,
      source: params.source ?? 'api',
      result: 'LEAD_ACCEPTANCE_FAILED',
      error_code: errorCode(error) ?? 'UNKNOWN_LEAD_ACCEPT_ERROR',
      trace_id: traceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: 'LEAD_ACCEPTANCE_FAILED', traceId }
  }

  if (!transactionResult.ok) {
    console.info('[matching] lead unlock/accept blocked', {
      provider_id: params.providerId,
      lead_id: params.leadId,
      source: params.source ?? 'api',
      result: transactionResult.reason,
      trace_id: traceId,
    })
    return {
      ok: false,
      reason: transactionResult.reason as
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'EXPIRED'
        | 'TAKEN'
        | 'INSUFFICIENT_CREDITS'
        | 'PROVIDER_NOT_APPROVED'
        | 'WALLET_SUSPENDED'
        | 'CONCURRENT_UNLOCK'
        | 'LEAD_ACCEPTANCE_FAILED',
      traceId,
    }
  }

  console.info('[matching] lead unlock/accept attempt', {
    provider_id: params.providerId,
    lead_id: params.leadId,
    source: params.source ?? 'api',
    current_credit_balance: transactionResult.currentCreditBalance,
    already_unlocked: transactionResult.alreadyUnlocked,
    lead_status_before: transactionResult.leadStatusBefore,
    lead_status_after: transactionResult.leadStatusAfter,
    credit_transaction_id: transactionResult.creditTransactionId,
    result: 'ACCEPTED',
    trace_id: traceId,
  })

  if (
    transactionResult.bookingId &&
    transactionResult.paymentAmount != null &&
    transactionResult.paymentAmount > 0
  ) {
    // Fire-and-forget: payment init runs after the transaction commits.
    // A failure here must not surface as a WhatsApp/PWA error - the accept
    // already succeeded and the credit was charged. Ops can reconcile via logs.
    initializeBookingPayment({
      bookingId: transactionResult.bookingId,
      amountRand: transactionResult.paymentAmount,
      customerEmail: null,
      customerPhone: transactionResult.customerPhone,
      description: `${transactionResult.category} booking`,
    }).catch((err: unknown) => {
      console.error('[matching] post-commit payment init failed', {
        booking_id: transactionResult.bookingId,
        trace_id: traceId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  if ('jobRequestId' in transactionResult && transactionResult.jobRequestId) {
    emitMatchEvent({
      event: 'match.accepted',
      jobRequestId: transactionResult.jobRequestId,
      providerId: params.providerId,
      bookingId: transactionResult.bookingId ?? '',
      latencyMs: Date.now() - acceptStart,
    })
  }

  return {
    ok: true,
    responseOutcome: transactionResult.responseOutcome as 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT' | 'EXPIRED' | 'OVERRIDDEN' | 'CANCELLED',
    matchId: transactionResult.matchId,
    bookingId: transactionResult.bookingId ?? null,
    creditTransactionId: transactionResult.creditTransactionId ?? null,
    currentCreditBalance: transactionResult.currentCreditBalance,
    alreadyUnlocked: transactionResult.alreadyUnlocked,
    assignmentHoldId: transactionResult.assignmentHoldId,
    nextOfferedProviderId: transactionResult.nextOfferedProviderId,
  }
}

export async function processPendingAssignmentWorkflows() {
  // Process at most 50 expired holds per cron tick to avoid function timeout under burst load.
  const activeHolds = await safeOptionalQuery(
    () =>
      db.assignmentHold.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lte: new Date() },
        },
        select: { id: true },
        take: 50,
      }),
    [] as Array<{ id: string }>,
  )

  let expiredOffers = 0
  let reoffered = 0

  for (const hold of activeHolds) {
    const result = await expireAssignmentOffer({ assignmentHoldId: hold.id })
    if (result.expired) {
      expiredOffers++
      if (result.nextOfferedProviderId) {
        reoffered++
      }
    }
  }

  return {
    processed: activeHolds.length,
    expiredOffers,
    reoffered,
  }
}

export async function sendQuickMatchProgressUpdates(now = new Date()): Promise<{
  considered: number
  sent: number
  skippedRecent: number
  skippedNoPhone: number
  skippedFinalNoMatch: number
  failed: number
}> {
  const progressLookbackCutoff = new Date(
    now.getTime() - getUrgencyMatchingPolicy('flexible').hardGiveUpMinutes * 60_000,
  )

  // OPEN is the live status for Quick Match AUTO_ASSIGN requests - the status
  // never transitions to MATCHING in this flow. Also include MATCHING in case
  // a legacy transition fired. Remove the active-hold filter so updates fire
  // in the gap between holds (rotating to next provider) as well as when held.
  const requests = await db.jobRequest.findMany({
    where: {
      status: { in: ['OPEN', 'MATCHING'] },
      assignmentMode: 'AUTO_ASSIGN',
      createdAt: { gte: progressLookbackCutoff },
    },
    select: {
      id: true,
      category: true,
      urgency: true,
      isTestRequest: true,
      cohortName: true,
      customer: { select: { phone: true, isTestUser: true } },
      dispatchDecisions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { failureClass: true, primaryReason: true },
      },
    },
    take: 50,
  })

  const result = {
    considered: requests.length,
    sent: 0,
    skippedRecent: 0,
    skippedNoPhone: 0,
    skippedFinalNoMatch: 0,
    failed: 0,
  }

  for (const request of requests) {
    const latestDecision = request.dispatchDecisions[0] ?? null
    if (
      latestDecision?.failureClass === 'EMPTY_POOL' ||
      latestDecision?.failureClass === 'STRUCTURAL'
    ) {
      result.skippedFinalNoMatch++
      console.info('[matching] quick-match progress skipped after final no-match', {
        jobRequestId: request.id,
        failureClass: latestDecision.failureClass,
        primaryReason: latestDecision.primaryReason,
      })
      continue
    }

    const phone = request.customer?.phone
    if (!phone) {
      result.skippedNoPhone++
      continue
    }

    const policy = getUrgencyMatchingPolicy(request.urgency)
    const recentCutoff = new Date(now.getTime() - policy.progressPingMinutes * 60_000)
    const recent = await db.messageEvent.findFirst({
      where: {
        to: phone,
        templateName: 'interactive:quick_match_progress_update',
        status: { in: ['SENT', 'DELIVERED', 'READ'] },
        createdAt: { gte: recentCutoff },
        metadata: {
          path: ['jobRequestId'],
          equals: request.id,
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })

    if (recent) {
      result.skippedRecent++
      continue
    }

    try {
      await sendText(
        phone,
        `Quick Match is still checking providers for your ${request.category} request.\n\nWe'll keep trying the next suitable provider and message you as soon as there is an update.`,
        {
          templateName: 'interactive:quick_match_progress_update',
          metadata: {
            jobRequestId: request.id,
            isTestRequest: request.isTestRequest,
            cohortName: request.cohortName,
            recipientIsTest: request.customer?.isTestUser ?? false,
            idempotencyKey: `quick_match_progress:${request.id}:${Math.floor(now.getTime() / (policy.progressPingMinutes * 60_000))}`,
          },
        },
      )
      result.sent++
    } catch (err) {
      result.failed++
      console.error('[matching] quick-match customer progress update failed', {
        jobRequestId: request.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

// ── Capacity reconciliation ────────────────────────────────────────────────────
// Safety net: recomputes provider_capacity.activeHolds from actual active holds.
// Corrects any drift caused by process crashes or legacy code paths.
// Called at the start of every match-leads cron run.
export async function reconcileStaleAssignmentState(): Promise<{ corrected: number }> {
  const capacityRows = await safeOptionalQuery(
    () =>
      (db as any).providerCapacity?.findMany?.({
        where: { activeHolds: { gt: 0 } },
        select: { providerId: true, activeHolds: true },
      }),
    [] as Array<{ providerId: string; activeHolds: number }>,
  )

  let corrected = 0

  for (const row of capacityRows) {
    const actualCount = await db.assignmentHold
      .count({
        where: {
          providerId: row.providerId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      })
      .catch(() => row.activeHolds) // If count fails, keep existing value - don't corrupt

    if (actualCount !== row.activeHolds) {
      await (db as any).providerCapacity
        ?.update?.({
          where: { providerId: row.providerId },
          data: { activeHolds: actualCount, updatedAt: new Date() },
        })
        .catch(() => {}) // Non-fatal

      console.warn('[reconcile] corrected activeHolds', {
        providerId: row.providerId,
        was: row.activeHolds,
        now: actualCount,
      })
      corrected++
    }
  }

  return { corrected }
}

export async function rejectAssignmentOffer(params: {
  leadId: string
  providerId: string
  reasonCode?: string
}): Promise<OfferResolutionResult> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    include: { assignmentHold: true, matchAttempt: true },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (lead.providerId !== params.providerId) return { ok: false, reason: 'FORBIDDEN' }
  if (!lead.assignmentHold) return { ok: false, reason: 'TAKEN' }
  if (lead.assignmentHold.status !== 'ACTIVE') {
    return { ok: false, reason: 'TAKEN' }
  }

  const declined = await db.$transaction(async (tx) => {
    const declinedAt = new Date()
    // Guard against concurrent double-tap: only proceed if hold is still ACTIVE.
    const holdUpdate = await tx.assignmentHold.updateMany({
      where: { id: lead.assignmentHold!.id, status: 'ACTIVE' },
      data: {
        status: 'REJECTED',
        respondedAt: declinedAt,
        releasedAt: declinedAt,
        outcomeReasonCode: params.reasonCode ?? 'TECHNICIAN_REJECTED_OFFER',
      },
    })
    if (holdUpdate.count === 0) return false // concurrent decline won

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'DECLINED', respondedAt: declinedAt, declinedAt },
    })
    if (lead.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: lead.matchAttemptId },
        data: {
          stage: 'REJECTED',
          respondedAt: declinedAt,
          responseOutcome: 'REJECTED',
          reasonCode: params.reasonCode ?? 'TECHNICIAN_REJECTED_OFFER',
        },
      })
    }
    await releaseAssignmentHoldScheduleItems(tx, {
      assignmentHoldId: lead.assignmentHold!.id,
      itemType: 'ASSIGNMENT_HOLD',
    })
    return true
  })

  if (!declined) {
    return { ok: false, reason: 'TAKEN' }
  }

  // Decrement the provider's capacity counter now that the hold is released.
  // Mirrors expireAssignmentOffer - must run outside the transaction so a
  // failure here does not roll back the decline.
  await releaseProviderCapacity(lead.assignmentHold.providerId).catch((err) =>
    console.error('[rejectAssignmentOffer] releaseProviderCapacity failed', {
      providerId: lead.assignmentHold!.providerId,
      leadId: params.leadId,
      err,
    })
  )

  let nextOfferedProviderId: string | null = null
  // Prefer lead.dispatchDecisionId (old path, pre-queued ranked candidates).
  // Fall back to hold.dispatchDecisionId (orchestrator path, stub decision).
  // In both cases offerNextRankedCandidate resets the job to OPEN when no
  // ranked candidates remain, so the cron re-dispatches on the next tick.
  const dispatchDecisionId = lead.dispatchDecisionId ?? lead.assignmentHold?.dispatchDecisionId ?? null
  if (dispatchDecisionId) {
    const next = await offerNextRankedCandidate({
      jobRequestId: lead.jobRequestId,
      dispatchDecisionId,
    })
    nextOfferedProviderId = next.nextOfferedProviderId
  } else {
    // No dispatch decision on lead or hold - reset directly so cron can retry.
    await db.jobRequest.update({
      where: { id: lead.jobRequestId },
      data: { status: 'OPEN' },
    })
    console.warn('[matching] declined lead has no dispatch decision; reset job to OPEN for re-dispatch', {
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      providerId: params.providerId,
    })
  }

  emitMatchEvent({
    event: 'match.declined',
    jobRequestId: lead.jobRequestId,
    providerId: params.providerId,
    holdId: lead.assignmentHold.id,
    reason: params.reasonCode,
  })

  await notifyCustomerProviderRotation({
    jobRequestId: lead.jobRequestId,
    reason: 'provider_declined',
    nextOfferedProviderId,
  }).catch(() => undefined)

  return {
    ok: true,
    responseOutcome: 'REJECTED',
    matchId: null,
    assignmentHoldId: lead.assignmentHold.id,
    nextOfferedProviderId,
  }
}

export async function expireAssignmentOffer(params: {
  assignmentHoldId: string
}) {
  const traceId = createTraceId('lead_expiry')
  const hold = await db.assignmentHold.findUnique({
    where: { id: params.assignmentHoldId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      matchAttemptId: true,
      dispatchDecisionId: true,
      jobRequestId: true,
      providerId: true,
      provider: { select: { phone: true, name: true } },
      jobRequest: {
        select: {
          category: true,
          address: { select: { suburb: true, city: true } },
        },
      },
    },
  })

  if (!hold) return { expired: false, nextOfferedProviderId: null }
  if (hold.status !== 'ACTIVE' || hold.expiresAt > new Date()) {
    return { expired: false, nextOfferedProviderId: null }
  }

  let expiredLeadCount = 0

  await db.$transaction(async (tx) => {
    await tx.assignmentHold.update({
      where: { id: hold.id },
      data: {
        status: 'EXPIRED',
        respondedAt: new Date(),
        releasedAt: new Date(),
        outcomeReasonCode: 'OFFER_TIMEOUT',
      },
    })
    // Include INTERESTED: providers who expressed free interest in dispatch_v2
    // mode must also have their lead marked EXPIRED when the hold times out.
    // Without this, their lead status stays INTERESTED indefinitely, causing
    // stale shortlist state and incorrect selectable-guard checks.
    const leadUpdate = await tx.lead.updateMany({
      where: {
        assignmentHoldId: hold.id,
        status: { in: ['SENT', 'VIEWED', 'INTERESTED'] },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    })
    expiredLeadCount = leadUpdate.count
    // Guard: matchAttemptId may be null if this is a legacy or stub path.
    // Only update matchAttempt if the ID is present.
    if (hold.matchAttemptId) {
      await tx.matchAttempt.update({
        where: { id: hold.matchAttemptId },
        data: {
          stage: 'TIMED_OUT',
          respondedAt: new Date(),
          responseOutcome: 'TIMED_OUT',
          reasonCode: 'OFFER_TIMEOUT',
        },
      })
    } else {
      console.warn('[expireAssignmentOffer] matchAttemptId is null, skipping matchAttempt update', {
        holdId: hold.id,
        jobRequestId: hold.jobRequestId,
      })
    }
    await releaseAssignmentHoldScheduleItems(tx, {
      assignmentHoldId: hold.id,
      itemType: 'ASSIGNMENT_HOLD',
    })
  })

  // Decrement the provider's capacity counter - this must happen outside the
  // transaction so it runs even if offerNextRankedCandidate fails below.
  await releaseProviderCapacity(hold.providerId).catch((err) =>
    console.error('[expireAssignmentOffer] releaseProviderCapacity failed', { providerId: hold.providerId, err })
  )
  await pauseProviderAfterRepeatedOfferTimeouts(hold.providerId).catch((err) =>
    console.error('[expireAssignmentOffer] provider auto-pause check failed', { providerId: hold.providerId, err })
  )

  const next = await offerNextRankedCandidate({
    jobRequestId: hold.jobRequestId,
    dispatchDecisionId: hold.dispatchDecisionId,
  })

  if (expiredLeadCount > 0) {
    await notifyProviderLeadInviteExpired({
      hold,
      wasReassigned: next.nextOfferedProviderId !== null,
      traceId,
    }).catch((err) => {
      console.error('[expireAssignmentOffer] provider expiry notification failed', {
        trace_id: traceId,
        provider_id: hold.providerId,
        job_request_id: hold.jobRequestId,
        assignment_hold_id: hold.id,
        error_code: 'LEAD_EXPIRY_NOTIFICATION_FAILED',
        err,
      })
    })
  } else {
    console.info('[expireAssignmentOffer] skipped provider expiry notification: no sent/viewed lead was expired', {
      trace_id: traceId,
      provider_id: hold.providerId,
      job_request_id: hold.jobRequestId,
      assignment_hold_id: hold.id,
      result: 'no_actionable_lead_at_expiry',
    })
  }

  // When all candidates exhausted the job is now EXPIRED - notify the customer and last provider
  if (!next.nextOfferedProviderId) {
    await notifyExpiredJobParties({
      jobRequestId: hold.jobRequestId,
      lastProviderId: hold.providerId,
    })
  }

  // Count how many candidates have been offered (non-RANKED = already attempted)
  const attemptsCompleted = hold.dispatchDecisionId
    ? await db.matchAttempt
        .count({ where: { dispatchDecisionId: hold.dispatchDecisionId, stage: { not: 'RANKED' } } })
        .catch(() => 0)
    : 0

  emitMatchEvent({
    event: 'match.hold_expired',
    jobRequestId: hold.jobRequestId,
    providerId: hold.providerId,
    holdId: hold.id,
    cascaded: next.nextOfferedProviderId !== null,
  })

  if (next.nextOfferedProviderId) {
    emitMatchEvent({
      event: 'match.rematch',
      jobRequestId: hold.jobRequestId,
      attempt: attemptsCompleted,
      triggeredBy: 'hold_expiry',
    })
    await notifyCustomerProviderRotation({
      jobRequestId: hold.jobRequestId,
      reason: 'provider_timeout',
      nextOfferedProviderId: next.nextOfferedProviderId,
    }).catch(() => undefined)
  } else {
    emitMatchEvent({
      event: 'match.exhausted',
      jobRequestId: hold.jobRequestId,
      attempts: attemptsCompleted,
    })
  }

  return { expired: true, nextOfferedProviderId: next.nextOfferedProviderId }
}

export async function getDispatchHistory(jobRequestId: string): Promise<DispatchHistoryResult[]> {
  const dispatchDecisions = await db.dispatchDecision.findMany({
    where: { jobRequestId },
    include: {
      matchAttempts: {
        orderBy: [{ rankedPosition: 'asc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return dispatchDecisions.map((dispatchDecision) => ({
    dispatchDecision,
    attempts: dispatchDecision.matchAttempts,
  }))
}

export async function manualOverrideAssignment(params: {
  jobRequestId: string
  providerId: string
  actor: DispatchActor
  overrideReason: string
}) {
  const ranking = await rankCandidatesForJobRequest(params.jobRequestId)
  const decision = await persistDispatchDecision({
    ranking,
    actor: params.actor,
    mode: 'MANUAL_OVERRIDE',
    overrideProviderId: params.providerId,
    overrideReason: params.overrideReason,
  })

  let attempt = await db.matchAttempt.findFirst({
    where: {
      dispatchDecisionId: decision.id,
      providerId: params.providerId,
    },
  })

  if (!attempt) {
    attempt = await db.matchAttempt.create({
      data: {
        jobRequestId: params.jobRequestId,
        providerId: params.providerId,
        dispatchDecisionId: decision.id,
        attemptNumber: ranking.candidates.length + 1,
        rankedPosition: ranking.candidates.length + 1,
        stage: 'OVERRIDDEN',
        hardFilterPassed: true,
        filteredReasonCodes: [],
        feasibilityNotes: ['Selected manually by admin override'],
        score: 0,
        scoreBreakdown: {
          overridden: true,
          reason: params.overrideReason,
        } as Prisma.InputJsonValue,
        reasonCode: 'ADMIN_OVERRIDE',
      },
    })
  } else {
    await db.matchAttempt.update({
      where: { id: attempt.id },
      data: {
        stage: 'OVERRIDDEN',
        responseOutcome: 'OVERRIDDEN',
        reasonCode: 'ADMIN_OVERRIDE',
      },
    })
  }

  const offer = await createOfferForAttempt({
    dispatchDecisionId: decision.id,
    jobRequestId: params.jobRequestId,
    matchAttemptId: attempt.id,
    providerId: params.providerId,
    actor: params.actor,
  })

  await db.dispatchDecision.update({
    where: { id: decision.id },
    data: {
      status: 'OVERRIDDEN',
      selectedProviderId: params.providerId,
      selectedMatchAttemptId: attempt.id,
      overrideReason: params.overrideReason,
    },
  })

  return {
    dispatchDecisionId: decision.id,
    assignmentHoldId: offer.hold.id,
  }
}
