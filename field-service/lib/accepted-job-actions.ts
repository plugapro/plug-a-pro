import { db } from './db'
import { recordAuditLog } from './audit'
import { AUDIT_ENTITY } from './audit-entities'
import {
  getProviderLeadAccessUrl,
  resolveProviderLeadAccessToken,
  verifyProviderLeadAccessToken,
} from './provider-lead-access'

type AcceptedLeadAction = 'customer_contacted' | 'on_the_way' | 'arrived' | 'started' | 'completed'

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

function providerFirstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'Your provider'
}

function ref(id: string) {
  return id.slice(-8).toUpperCase()
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
}) {
  const lead = await resolveAcceptedLeadFromToken({ leadId: params.leadId, token: params.token })
  if (!lead) return { ok: false as const, reason: 'UNAVAILABLE' as const }

  const match = lead.jobRequest.match
  if (!match) return { ok: false as const, reason: 'UNAVAILABLE' as const }
  const normalizedNote = params.note?.trim() || null
  const plannedArrivalEnd = params.plannedArrivalEnd ?? null
  if (Number.isNaN(params.plannedArrivalStart.getTime())) {
    return { ok: false as const, reason: 'INVALID_TIME' as const }
  }
  if (plannedArrivalEnd && plannedArrivalEnd <= params.plannedArrivalStart) {
    return { ok: false as const, reason: 'INVALID_TIME' as const }
  }

  const sameWindow =
    match.plannedArrivalStart?.getTime() === params.plannedArrivalStart.getTime() &&
    (match.plannedArrivalEnd?.getTime() ?? null) === (plannedArrivalEnd?.getTime() ?? null) &&
    (match.plannedArrivalNote ?? null) === normalizedNote

  if (sameWindow) return { ok: true as const, duplicate: true }

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
    },
  }).catch(() => {})

  await notifyCustomer({
    phone: lead.jobRequest.customer.phone,
    templateName: 'post_match_customer_arrival_planned',
    leadId: lead.id,
    jobRequestId: lead.jobRequestId,
    matchId: match.id,
    action: 'arrival_planned',
    text:
      `📅 *Update on your ${lead.jobRequest.category} request*\n\n` +
      `${providerFirstName(lead.provider.name)} plans to arrive ${formatArrivalWindow(params.plannedArrivalStart, plannedArrivalEnd)}.\n\n` +
      `Ref: *${ref(lead.jobRequestId)}*\n\nReply *status* anytime to check your booking.`,
  })

  return { ok: true as const, duplicate: false }
}

export async function markAcceptedLeadAction(params: {
  leadId: string
  token: string
  action: AcceptedLeadAction
}) {
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

  const url = await getProviderLeadAccessUrl({
    leadId: lead.id,
    providerId: lead.providerId,
  })
  if (!url) return { ok: false as const, reason: 'NO_URL' as const }

  const { sendCtaUrl } = await import('./whatsapp-interactive')
  await sendCtaUrl(
    lead.provider.phone,
    `Here's a fresh secure link for your accepted ${lead.jobRequest.category} job with ${firstName(lead.jobRequest.customer.name)}.`,
    'View Job',
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
