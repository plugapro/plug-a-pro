import { db } from './db'
import { recordAuditLog } from './audit'
import { AUDIT_ENTITY } from './audit-entities'
import {
  getCustomerAvailabilitySummary,
  validateArrivalWindowAgainstCustomerAvailability,
  type ArrivalValidationErrorCode,
} from './arrival-availability'
import {
  getProviderSignedJobHandoverUrl,
  resolveProviderLeadAccessToken,
  verifyProviderLeadAccessToken,
  providerLeadTokenAllowsScope,
  LEAD_RESPONSE_SCOPES,
  type ProviderLeadAccessScope,
} from './provider-lead-access'
import { ctaLabelFor } from './whatsapp-copy'
import { transitionJob } from './jobs'
import { getPublicAppUrl } from './provider-credit-copy'

type AcceptedLeadAction = 'customer_contacted' | 'on_the_way' | 'arrived' | 'started' | 'completed'
type SaveArrivalErrorCode =
  | ArrivalValidationErrorCode
  | 'PROVIDER_NOT_ASSIGNED_TO_JOB'
  | 'JOB_NOT_SCHEDULABLE'
  | 'CUSTOMER_NOTIFICATION_FAILED'
  | 'UNKNOWN_SCHEDULE_SAVE_ERROR'

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function providerFirstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'Your provider'
}

function ref(id: string) {
  return id.slice(-8).toUpperCase()
}

function createTraceId() {
  return `arrival_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function formatArrivalWindow(start: Date, end: Date | null | undefined) {
  const day = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(start)
  const startTime = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
  }).format(start)
  const endTime = end
    ? new Intl.DateTimeFormat('en-ZA', {
        timeZone: 'Africa/Johannesburg',
        hour: '2-digit',
        minute: '2-digit',
      }).format(end)
    : null

  return endTime ? `${day} between ${startTime} and ${endTime}` : `${day} at ${startTime}`
}

async function loadAcceptedLead(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      provider: { select: { id: true, name: true, phone: true } },
      jobRequest: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: true,
          match: true,
        },
      },
    },
  })

  if (!lead || lead.status !== 'ACCEPTED' || !lead.jobRequest.match) return null
  if (lead.jobRequest.match.providerId !== lead.providerId) return null
  if (lead.jobRequest.match.status === 'CANCELLED') return null
  if (lead.jobRequest.status === 'CANCELLED' || lead.jobRequest.status === 'EXPIRED') return null
  return lead
}

async function resolveAcceptedLeadFromToken(params: { token: string; leadId: string }) {
  const resolved = await resolveProviderLeadAccessToken(params.token)
  if (resolved.status !== 'active' || !resolved.lead || resolved.lead.id !== params.leadId) {
    return null
  }
  return loadAcceptedLead(params.leadId)
}

function tokenAllowsAcceptedJobScope(params: {
  token: string
  scope: ProviderLeadAccessScope
}) {
  const verified = verifyProviderLeadAccessToken(params.token)
  if (verified.status !== 'active') return false
  const { payload } = verified
  if (providerLeadTokenAllowsScope(payload, params.scope)) return true
  // A LEAD_RESPONSE_SCOPES token (the original WhatsApp invite URL) identifies the
  // assigned provider. After acceptance the same token may be used to perform job
  // actions — the actual accepted-state check happens in resolveAcceptedLeadFromToken.
  return payload.scopes?.some((s) => LEAD_RESPONSE_SCOPES.includes(s as ProviderLeadAccessScope)) ?? false
}

async function notifyCustomer(params: {
  phone: string
  text: string
  templateName: string
  leadId: string
  jobRequestId: string
  matchId: string
  action: string
}) {
  const { sendText } = await import('./whatsapp-interactive')
  await sendText(params.phone, params.text, {
    templateName: params.templateName,
    metadata: {
      leadId: params.leadId,
      jobRequestId: params.jobRequestId,
      matchId: params.matchId,
      action: params.action,
    },
  })
}

export async function saveAcceptedLeadArrival(params: {
  leadId: string
  token: string
  plannedArrivalStart: Date
  plannedArrivalEnd?: Date | null
  note?: string | null
}): Promise<
  | { ok: true; duplicate: boolean; traceId: string; updatedAt: Date; plannedArrivalStart: Date; plannedArrivalEnd: Date | null }
  | { ok: false; reason: SaveArrivalErrorCode | 'UNAVAILABLE' | 'INVALID_TIME'; message: string; traceId: string }
> {
  const traceId = createTraceId()
  if (!tokenAllowsAcceptedJobScope({ token: params.token, scope: 'confirm_arrival' })) {
    console.warn('[accepted-job] arrival save blocked: token scope check failed', {
      lead_id: params.leadId,
      scope: 'confirm_arrival',
      trace_id: traceId,
    })
    return {
      ok: false as const,
      reason: 'PROVIDER_NOT_ASSIGNED_TO_JOB',
      message: 'This secure job link is not allowed to update arrival times.',
      traceId,
    }
  }

  const lead = await resolveAcceptedLeadFromToken({ leadId: params.leadId, token: params.token })
  if (!lead) {
    console.warn('[accepted-job] arrival save blocked: lead not found or not accepted for this provider', {
      lead_id: params.leadId,
      trace_id: traceId,
    })
    return {
      ok: false as const,
      reason: 'PROVIDER_NOT_ASSIGNED_TO_JOB',
      message: 'This accepted job is not available to this provider.',
      traceId,
    }
  }

  const match = lead.jobRequest.match
  if (!match) {
    return {
      ok: false as const,
      reason: 'JOB_NOT_SCHEDULABLE',
      message: 'This job is not in a schedulable state.',
      traceId,
    }
  }
  const normalizedNote = params.note?.trim() || null
  const plannedArrivalEnd = params.plannedArrivalEnd ?? null
  if (Number.isNaN(params.plannedArrivalStart.getTime())) {
    return {
      ok: false as const,
      reason: 'INVALID_ARRIVAL_TIME',
      message: 'The selected arrival date or time is invalid.',
      traceId,
    }
  }
  if (plannedArrivalEnd && plannedArrivalEnd <= params.plannedArrivalStart) {
    return {
      ok: false as const,
      reason: 'ARRIVAL_END_BEFORE_START',
      message: 'Arrival end time must be after the start time.',
      traceId,
    }
  }

  const availability = getCustomerAvailabilitySummary({
    requestedWindowStart: lead.jobRequest.requestedWindowStart,
    requestedWindowEnd: lead.jobRequest.requestedWindowEnd,
    requestedArrivalLatest: lead.jobRequest.requestedArrivalLatest,
    description: lead.jobRequest.description,
  })
  const validation = validateArrivalWindowAgainstCustomerAvailability({
    availability,
    proposedStart: params.plannedArrivalStart,
    proposedEnd: plannedArrivalEnd,
  })

  if (!validation.isValid) {
    await recordAuditLog({
      actorId: lead.providerId,
      actorRole: 'provider',
      action: 'match.arrival_plan_rejected',
      entityType: AUDIT_ENTITY.JOB_REQUEST,
      entityId: lead.jobRequestId,
      before: {
        plannedArrivalStart: match.plannedArrivalStart?.toISOString() ?? null,
        plannedArrivalEnd: match.plannedArrivalEnd?.toISOString() ?? null,
        plannedArrivalNote: match.plannedArrivalNote ?? null,
        status: match.status,
      },
      after: {
        proposedArrivalStart: params.plannedArrivalStart.toISOString(),
        proposedArrivalEnd: plannedArrivalEnd?.toISOString() ?? null,
        proposedArrivalNote: normalizedNote,
        validationResult: validation.errorCode,
        customerAvailability: availability.label,
        statusAfter: match.status,
        notificationResult: 'not_sent',
        traceId,
      },
    }).catch(() => {})

    console.info('[accepted-job] arrival save rejected', {
      job_id: lead.jobRequestId,
      provider_id: lead.providerId,
      customer_id: lead.jobRequest.customer.id,
      previous_arrival_window: {
        start: match.plannedArrivalStart?.toISOString() ?? null,
        end: match.plannedArrivalEnd?.toISOString() ?? null,
      },
      proposed_arrival_window: {
        start: params.plannedArrivalStart.toISOString(),
        end: plannedArrivalEnd?.toISOString() ?? null,
      },
      validation_result: validation.errorCode,
      status_before: match.status,
      status_after: match.status,
      notification_result: 'not_sent',
      trace_id: traceId,
      timestamp: new Date().toISOString(),
    })

    return {
      ok: false as const,
      reason: validation.errorCode,
      message: validation.reason,
      traceId,
    }
  }

  const sameWindow =
    match.plannedArrivalStart?.getTime() === params.plannedArrivalStart.getTime() &&
    (match.plannedArrivalEnd?.getTime() ?? null) === (plannedArrivalEnd?.getTime() ?? null) &&
    (match.plannedArrivalNote ?? null) === normalizedNote

  if (sameWindow) {
    return {
      ok: true as const,
      duplicate: true,
      traceId,
      updatedAt: new Date(),
      plannedArrivalStart: params.plannedArrivalStart,
      plannedArrivalEnd,
    }
  }

  const updatedAt = new Date()
  await db.match.update({
    where: { id: match.id },
    data: {
      plannedArrivalStart: params.plannedArrivalStart,
      plannedArrivalEnd,
      plannedArrivalNote: normalizedNote,
    },
  })

  await recordAuditLog({
    actorId: lead.providerId,
    actorRole: 'provider',
    action: 'match.arrival_planned',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    before: {
      plannedArrivalStart: match.plannedArrivalStart?.toISOString() ?? null,
      plannedArrivalEnd: match.plannedArrivalEnd?.toISOString() ?? null,
      plannedArrivalNote: match.plannedArrivalNote ?? null,
    },
    after: {
      plannedArrivalStart: params.plannedArrivalStart.toISOString(),
      plannedArrivalEnd: plannedArrivalEnd?.toISOString() ?? null,
      plannedArrivalNote: normalizedNote,
      statusBefore: match.status,
      statusAfter: match.status,
      validationResult: 'VALID',
      customerAvailability: availability.label,
      notificationResult: 'pending',
      traceId,
    },
  }).catch(() => {})

  try {
    await notifyCustomer({
      phone: lead.jobRequest.customer.phone,
      templateName: 'post_match_customer_arrival_planned',
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      matchId: match.id,
      action: 'arrival_planned',
      text:
        `📅 *Update on your ${lead.jobRequest.category} request*\n\n` +
        `${providerFirstName(lead.provider.name)} plans to arrive on ${formatArrivalWindow(params.plannedArrivalStart, plannedArrivalEnd)}.\n\n` +
        `Ref: *${ref(lead.jobRequestId)}*` +
        (normalizedNote ? `\n\nNote from provider: ${normalizedNote}` : ''),
    })
  } catch (error) {
    await recordAuditLog({
      actorId: lead.providerId,
      actorRole: 'provider',
      action: 'match.arrival_notification_failed',
      entityType: AUDIT_ENTITY.JOB_REQUEST,
      entityId: lead.jobRequestId,
      after: {
        leadId: lead.id,
        matchId: match.id,
        notificationResult: 'failed',
        error: error instanceof Error ? error.message : String(error),
        traceId,
      },
    }).catch(() => {})
    return {
      ok: false as const,
      reason: 'CUSTOMER_NOTIFICATION_FAILED',
      message: 'Arrival time was saved, but the customer WhatsApp notification failed.',
      traceId,
    }
  }

  console.info('[accepted-job] arrival save completed', {
    job_id: lead.jobRequestId,
    provider_id: lead.providerId,
    customer_id: lead.jobRequest.customer.id,
    previous_arrival_window: {
      start: match.plannedArrivalStart?.toISOString() ?? null,
      end: match.plannedArrivalEnd?.toISOString() ?? null,
    },
    proposed_arrival_window: {
      start: params.plannedArrivalStart.toISOString(),
      end: plannedArrivalEnd?.toISOString() ?? null,
    },
    validation_result: 'VALID',
    status_before: match.status,
    status_after: match.status,
    notification_result: 'sent',
    trace_id: traceId,
    timestamp: updatedAt.toISOString(),
  })

  return {
    ok: true as const,
    duplicate: false,
    traceId,
    updatedAt,
    plannedArrivalStart: params.plannedArrivalStart,
    plannedArrivalEnd,
  }
}

export async function markAcceptedLeadAction(params: {
  leadId: string
  token: string
  action: AcceptedLeadAction
}) {
  const scopeByAction: Record<AcceptedLeadAction, ProviderLeadAccessScope> = {
    customer_contacted: 'mark_customer_contacted',
    on_the_way: 'mark_on_the_way',
    arrived: 'mark_arrived',
    started: 'start_job',
    completed: 'complete_job',
  }
  if (!tokenAllowsAcceptedJobScope({ token: params.token, scope: scopeByAction[params.action] })) {
    return { ok: false as const, reason: 'UNAVAILABLE' as const }
  }

  const lead = await resolveAcceptedLeadFromToken({ leadId: params.leadId, token: params.token })
  if (!lead) return { ok: false as const, reason: 'UNAVAILABLE' as const }

  const match = lead.jobRequest.match
  if (!match) return { ok: false as const, reason: 'UNAVAILABLE' as const }
  const fieldByAction = {
    customer_contacted: 'customerContactedAt',
    on_the_way: 'providerOnTheWayAt',
    arrived: 'providerArrivedAt',
    started: 'providerStartedAt',
    completed: 'providerCompletedAt',
  } as const
  const field = fieldByAction[params.action]
  if (match[field]) return { ok: true as const, duplicate: true }

  const now = new Date()
  await db.match.update({
    where: { id: match.id },
    data: { [field]: now },
  })

  await recordAuditLog({
    actorId: lead.providerId,
    actorRole: 'provider',
    action: `match.${params.action}`,
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    after: {
      leadId: lead.id,
      matchId: match.id,
      at: now.toISOString(),
    },
  }).catch(() => {})

  const provider = providerFirstName(lead.provider.name)
  const category = lead.jobRequest.category
  const customerPhone = lead.jobRequest.customer.phone

  if (params.action === 'on_the_way') {
    await notifyCustomer({
      phone: customerPhone,
      templateName: 'post_match_customer_provider_on_the_way',
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      matchId: match.id,
      action: params.action,
      text: `🚗 ${provider} is on the way for your ${category} request.\n\nEstimated arrival: ${match.plannedArrivalStart ? formatArrivalWindow(match.plannedArrivalStart, match.plannedArrivalEnd) : 'soon'}.`,
    })
  }

  if (params.action === 'arrived') {
    await notifyCustomer({
      phone: customerPhone,
      templateName: 'post_match_customer_provider_arrived',
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      matchId: match.id,
      action: params.action,
      text: `✅ ${provider} has arrived for your ${category} request.`,
    })
  }

  if (params.action === 'started') {
    await notifyCustomer({
      phone: customerPhone,
      templateName: 'post_match_customer_provider_started',
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      matchId: match.id,
      action: params.action,
      text: `🔧 ${provider} has started work on your ${category} request.`,
    })
  }

  if (params.action === 'completed') {
    await notifyCustomer({
      phone: customerPhone,
      templateName: 'post_match_customer_provider_completed',
      leadId: lead.id,
      jobRequestId: lead.jobRequestId,
      matchId: match.id,
      action: params.action,
      text: `✅ Your ${category} job has been marked complete.\n\nWe'll follow up shortly for confirmation, invoice, or feedback.`,
    })
  }

  return { ok: true as const, duplicate: false }
}

export async function sendFreshAcceptedJobLink(params: { token: string }) {
  const verified = verifyProviderLeadAccessToken(params.token)
  if (verified.status !== 'expired' || !verified.payload) {
    return { ok: false as const, reason: 'INVALID_TOKEN' as const }
  }

  const lead = await loadAcceptedLead(verified.payload.leadId)
  if (!lead || lead.providerId !== verified.payload.providerId) {
    return { ok: false as const, reason: 'UNAVAILABLE' as const }
  }
  const match = lead.jobRequest.match
  if (!match) return { ok: false as const, reason: 'UNAVAILABLE' as const }

  const url = await getProviderSignedJobHandoverUrl({
    leadId: lead.id,
    providerId: lead.providerId,
    jobRequestId: lead.jobRequestId,
    providerPhone: lead.provider.phone,
  })
  if (!url) return { ok: false as const, reason: 'NO_URL' as const }

  const { sendCtaUrl } = await import('./whatsapp-interactive')
  await sendCtaUrl(
    lead.provider.phone,
    `Here's a fresh secure link for your accepted ${lead.jobRequest.category} job with ${firstName(lead.jobRequest.customer.name)}.`,
    ctaLabelFor('view_job'),
    url,
    { footer: 'This link is scoped to this accepted job only.' },
    {
      templateName: 'post_match_provider_fresh_job_link',
      metadata: {
        leadId: lead.id,
        jobRequestId: lead.jobRequestId,
        matchId: match.id,
        providerId: lead.providerId,
      },
    },
  )

  return { ok: true as const }
}

// ─── Mark job complete ────────────────────────────────────────────────────────
// Minimal flow: provider taps "Mark job done" → job COMPLETED → customer review
// WhatsApp sent. Skips all intermediate milestones.

async function loadAcceptedLeadWithBooking(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      provider: { select: { id: true, name: true, phone: true } },
      jobRequest: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          match: {
            include: {
              booking: {
                include: { job: { select: { id: true, status: true } } },
              },
            },
          },
        },
      },
    },
  })

  if (!lead || lead.status !== 'ACCEPTED' || !lead.jobRequest.match) return null
  if (lead.jobRequest.match.providerId !== lead.providerId) return null
  if (lead.jobRequest.match.status === 'CANCELLED') return null
  if (lead.jobRequest.status === 'CANCELLED' || lead.jobRequest.status === 'EXPIRED') return null
  return lead
}

export async function markJobComplete(params: {
  leadId: string
  token: string
}): Promise<
  | { ok: true; duplicate: boolean; bookingId: string | null }
  | { ok: false; reason: 'UNAVAILABLE' | 'NO_JOB' }
> {
  if (!tokenAllowsAcceptedJobScope({ token: params.token, scope: 'complete_job' })) {
    return { ok: false as const, reason: 'UNAVAILABLE' }
  }

  const lead = await loadAcceptedLeadWithBooking(params.leadId)
  if (!lead) return { ok: false as const, reason: 'UNAVAILABLE' }

  const match = lead.jobRequest.match!
  const booking = match.booking
  const job = booking?.job

  if (match.providerCompletedAt) {
    return { ok: true as const, duplicate: true, bookingId: booking?.id ?? null }
  }

  await db.match.update({
    where: { id: match.id },
    data: { providerCompletedAt: new Date() },
  })

  if (job) {
    await transitionJob({
      jobId: job.id,
      toStatus: 'COMPLETED',
      actorId: lead.providerId,
      actorRole: 'provider',
      notes: 'Provider marked job done via lead page',
    })
  }

  const appUrl = getPublicAppUrl()
  const reviewUrl = booking ? `${appUrl}/bookings/${booking.id}/rate` : null

  const { notifyCustomerReviewRequested } = await import('./client-pwa-submission-notifications')
  await notifyCustomerReviewRequested({
    customerPhone: lead.jobRequest.customer.phone,
    category: lead.jobRequest.category,
    providerName: lead.provider.name,
    requestId: lead.jobRequestId,
    reviewUrl,
  })

  await recordAuditLog({
    actorId: lead.providerId,
    actorRole: 'provider',
    action: 'match.job_marked_complete',
    entityType: AUDIT_ENTITY.JOB_REQUEST,
    entityId: lead.jobRequestId,
    after: {
      leadId: lead.id,
      matchId: match.id,
      bookingId: booking?.id ?? null,
      jobId: job?.id ?? null,
      at: new Date().toISOString(),
    },
  }).catch(() => {})

  return { ok: true as const, duplicate: false, bookingId: booking?.id ?? null }
}
