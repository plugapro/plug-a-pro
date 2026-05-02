// ─── Provider WhatsApp job commands ──────────────────────────────────────────
// Direct WhatsApp text commands so providers can complete core operations
// without opening the PWA. The bot's existing menu-based path remains the
// fallback for ambiguous cases (multiple active jobs, no parseable input).
//
// Commands supported:
//   HH:MM                  — confirm arrival time on the most recent active job
//   confirm arrival HH:MM  — confirm arrival time on the most recent active job
//   arrive HH:MM          — confirm arrival time on the most recent active job
//   on the way / otw      — transition single active job → EN_ROUTE
//   arrived / i arrived   — transition single active job → ARRIVED
//   start / start work    — transition single active job → STARTED
//   complete / done       — mark single active job ready for sign-off
//
// Privacy: every handler verifies the inbound phone owns the target job
// before any state change.

import type { JobStatus } from '@prisma/client'
import { db } from './db'
import { transitionJob } from './jobs'

export type ProviderJobCommand =
  | { kind: 'arrive'; arrivalAt: Date; raw: string; jobRef?: string }
  | { kind: 'on_the_way'; raw: string; jobRef?: string }
  | { kind: 'arrived'; raw: string; jobRef?: string }
  | { kind: 'start'; raw: string; jobRef?: string }
  | { kind: 'complete'; raw: string; jobRef?: string }

export type ProviderJobCommandResult =
  | { ok: true; jobId: string; toStatus: JobStatus | null; message: string }
  | { ok: false; reason: 'PROVIDER_NOT_FOUND' | 'NO_ACTIVE_JOB' | 'AMBIGUOUS_JOB' | 'INVALID_COMMAND' | 'INVALID_TIME'; message: string }

export type ProviderJobCompletionResult =
  | { ok: true; jobId: string; duplicate: boolean; message: string }
  | { ok: false; reason: 'PROVIDER_NOT_FOUND' | 'JOB_NOT_FOUND' | 'INVALID_STATE'; message: string }

const ARRIVE_PATTERNS = [
  /^(?:confirm\s+arrival)\s+(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/i,
  /^(?:arrive|arrival|eta)\s+(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/i,
  /^(?:arrive|arrival|eta)\s+(\d{1,2})\s*(am|pm)$/i,
  /^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i,
]

// Phrase-style arrival commands recognised in addition to HH:MM patterns.
const ARRIVE_RELATIVE_PATTERNS: Array<{ regex: RegExp; resolve: (now: Date, match: RegExpMatchArray) => Date | null }> = [
  // "in 2 hours", "in 90 minutes", "in an hour", "in half an hour"
  {
    regex: /^(?:arrive|arrival|eta)\s+in\s+(\d{1,2})\s*(hours?|hrs?|hr|h)$/i,
    resolve: (now, m) => {
      const hours = Number(m[1])
      if (!Number.isFinite(hours) || hours < 1 || hours > 12) return null
      const candidate = new Date(now)
      candidate.setHours(now.getHours() + hours, 0, 0, 0)
      return candidate
    },
  },
  {
    regex: /^(?:arrive|arrival|eta)\s+in\s+(\d{1,3})\s*(minutes?|mins?|min)$/i,
    resolve: (now, m) => {
      const mins = Number(m[1])
      if (!Number.isFinite(mins) || mins < 5 || mins > 360) return null
      const candidate = new Date(now)
      candidate.setMinutes(now.getMinutes() + mins, 0, 0)
      return candidate
    },
  },
  {
    regex: /^(?:arrive|arrival|eta)\s+in\s+(?:an?|one)\s+hour$/i,
    resolve: (now) => {
      const candidate = new Date(now)
      candidate.setHours(now.getHours() + 1, 0, 0, 0)
      return candidate
    },
  },
  {
    regex: /^(?:arrive|arrival|eta)\s+in\s+(?:half\s+(?:an?\s+)?hour|30\s*(?:mins?|minutes?))$/i,
    resolve: (now) => {
      const candidate = new Date(now)
      candidate.setMinutes(now.getMinutes() + 30, 0, 0)
      return candidate
    },
  },
  // "arrive noon", "arrive midday"
  {
    regex: /^(?:arrive|arrival|eta)\s+(?:noon|midday|mid-day)$/i,
    resolve: (now) => {
      const candidate = new Date(now)
      candidate.setHours(12, 0, 0, 0)
      if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1)
      return candidate
    },
  },
  // "arrive later" / "arrive later today" → +3 hours
  {
    regex: /^(?:arrive|arrival|eta)\s+later(?:\s+today)?$/i,
    resolve: (now) => {
      const candidate = new Date(now)
      candidate.setHours(now.getHours() + 3, 0, 0, 0)
      return candidate
    },
  },
]

type ProviderJobStatusCommandKind = Exclude<ProviderJobCommand['kind'], 'arrive'>

const STATUS_ALIASES: Record<string, ProviderJobStatusCommandKind> = {
  'on the way': 'on_the_way',
  'on my way': 'on_the_way',
  'otw': 'on_the_way',
  'en route': 'on_the_way',
  'arrived': 'arrived',
  'i arrived': 'arrived',
  "i've arrived": 'arrived',
  'i have arrived': 'arrived',
  'start': 'start',
  'starting': 'start',
  'start work': 'start',
  'start job': 'start',
  'complete': 'complete',
  'completed': 'complete',
  'done': 'complete',
  'finished': 'complete',
  'complete job': 'complete',
  'finish job': 'complete',
}

// Provider may suffix any command with "#JOB-REF" (or "#JOBREF") so a
// multi-active-job provider can target a specific job. The ref is the last 8
// chars of jobRef, case-insensitive. Whitespace before the # is optional.
const JOB_REF_SUFFIX_PATTERN = /\s*#([a-z0-9-]{4,40})$/i

export function parseProviderJobCommand(text: string | null | undefined, options?: { now?: Date }): ProviderJobCommand | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  let jobRef: string | undefined
  let payload = trimmed
  const refMatch = payload.match(JOB_REF_SUFFIX_PATTERN)
  if (refMatch) {
    jobRef = refMatch[1].toUpperCase()
    payload = payload.slice(0, refMatch.index!).trim()
    if (!payload) return null
  }

  const normalised = payload.toLowerCase().replace(/\s+/g, ' ')
  if (!normalised) return null

  const now = options?.now ?? new Date()

  for (const pattern of ARRIVE_PATTERNS) {
    const match = normalised.match(pattern)
    if (match) {
      const arrivalAt = buildArrivalTime(match, now)
      return arrivalAt ? { kind: 'arrive', arrivalAt, raw: trimmed, ...(jobRef && { jobRef }) } : null
    }
  }

  for (const relative of ARRIVE_RELATIVE_PATTERNS) {
    const match = normalised.match(relative.regex)
    if (match) {
      const arrivalAt = relative.resolve(now, match)
      return arrivalAt ? { kind: 'arrive', arrivalAt, raw: trimmed, ...(jobRef && { jobRef }) } : null
    }
  }

  const matchedAlias = STATUS_ALIASES[normalised]
  if (matchedAlias) {
    return { kind: matchedAlias, raw: trimmed, ...(jobRef && { jobRef }) }
  }

  return null
}

function buildArrivalTime(match: RegExpMatchArray, now: Date = new Date()): Date | null {
  const hourPart = Number(match[1])
  const minutePart = match[2] ? Number(match[2]) : 0
  const meridiem = (match[3] ?? '').toLowerCase()

  if (Number.isNaN(hourPart) || Number.isNaN(minutePart)) return null
  if (minutePart < 0 || minutePart > 59) return null

  let hour = hourPart
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null

  // Build a same-day SAST arrival; if the time has already passed, push to next day.
  const candidate = new Date(now)
  candidate.setHours(hour, minutePart, 0, 0)
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate
}

export type ActiveJobLookupResult =
  | {
      state: 'unique'
      jobId: string
      status: JobStatus
      scheduledArrivalAt?: Date | null
      bookingId?: string | null
      providerName?: string | null
      customerPhone?: string | null
      customerName?: string | null
      category?: string | null
    }
  | { state: 'multiple' }
  | { state: 'none' }
  | { state: 'no_provider' }

// Pick the single most-recent active job for the provider with the given
// WhatsApp phone. When the provider supplies a job-ref suffix (#JOBREF),
// resolve to that specific job even if they have multiple active. Returns
// 'multiple' for non-targeted commands when more than one is in flight, so
// the caller can fall back to the pj_job_list menu.
export async function findSingleActiveJobForProviderPhone(
  phone: string,
  options?: { jobRef?: string },
): Promise<ActiveJobLookupResult> {
  const provider = await db.provider.findFirst({
    where: { phone },
    select: { id: true, name: true },
  })
  if (!provider) return { state: 'no_provider' }

  const activeJobs = await db.job.findMany({
    where: {
      providerId: provider.id,
      status: { in: ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PAUSED'] },
    },
    orderBy: { assignedAt: 'desc' },
    select: {
      id: true,
      status: true,
      scheduledArrivalAt: true,
      bookingId: true,
      jobRef: true,
      booking: {
        select: {
          match: {
            select: {
              jobRequest: {
                select: {
                  category: true,
                  customer: { select: { name: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (activeJobs.length === 0) return { state: 'none' }

  // Job-ref suffix → match that specific job by jobRef (case-insensitive,
  // last 8 chars or full ref).
  if (options?.jobRef) {
    const ref = options.jobRef.toUpperCase()
    const match = activeJobs.find((j) => j.jobRef && (
      j.jobRef.toUpperCase() === ref
      || j.jobRef.toUpperCase().endsWith(ref)
      || ref.endsWith(j.jobRef.toUpperCase())
    ))
    if (!match) return { state: 'none' }
    return {
      state: 'unique',
      jobId: match.id,
      status: match.status,
      scheduledArrivalAt: match.scheduledArrivalAt,
      bookingId: match.bookingId,
      providerName: provider.name,
      customerPhone: match.booking?.match?.jobRequest?.customer?.phone ?? null,
      customerName: match.booking?.match?.jobRequest?.customer?.name ?? null,
      category: match.booking?.match?.jobRequest?.category ?? null,
    }
  }

  if (activeJobs.length > 1) return { state: 'multiple' }
  const job = activeJobs[0]
  return {
    state: 'unique',
    jobId: job.id,
    status: job.status,
    scheduledArrivalAt: job.scheduledArrivalAt,
    bookingId: job.bookingId,
    providerName: provider.name,
    customerPhone: job.booking?.match?.jobRequest?.customer?.phone ?? null,
    customerName: job.booking?.match?.jobRequest?.customer?.name ?? null,
    category: job.booking?.match?.jobRequest?.category ?? null,
  }
}

const NEXT_STATUS: Record<ProviderJobStatusCommandKind, JobStatus> = {
  on_the_way: 'EN_ROUTE',
  arrived: 'ARRIVED',
  start: 'STARTED',
  complete: 'PENDING_COMPLETION_CONFIRMATION',
}

export async function executeProviderJobCommand(params: {
  phone: string
  command: ProviderJobCommand
}): Promise<ProviderJobCommandResult> {
  const lookup = await findSingleActiveJobForProviderPhone(params.phone, {
    jobRef: params.command.jobRef,
  })
  if (lookup.state === 'no_provider') {
    return { ok: false, reason: 'PROVIDER_NOT_FOUND', message: "We couldn't find your provider profile. Reply *Hi* to continue." }
  }
  if (lookup.state === 'none') {
    if (params.command.jobRef) {
      return {
        ok: false,
        reason: 'NO_ACTIVE_JOB',
        message: `We couldn't find an active job with reference *#${params.command.jobRef}*. Reply *my jobs* to see your active jobs.`,
      }
    }
    return { ok: false, reason: 'NO_ACTIVE_JOB', message: "You have no active jobs right now. Reply *my jobs* to refresh." }
  }
  if (lookup.state === 'multiple') {
    return {
      ok: false,
      reason: 'AMBIGUOUS_JOB',
      message:
        'You have more than one active job. Add the job reference to target a specific one, e.g. *arrive 14:00 #PAP-JOB-ABCDE123*. Or reply *my jobs* to pick from a list.',
    }
  }

  const { jobId, status } = lookup

  if (params.command.kind === 'arrive') {
    if (lookup.scheduledArrivalAt && sameMinute(lookup.scheduledArrivalAt, params.command.arrivalAt)) {
      return {
        ok: true,
        jobId,
        toStatus: null,
        message: `Arrival time already confirmed.\n\nCustomer has already been notified:\n${formatTime(params.command.arrivalAt)}`,
      }
    }

    await db.job.update({
      where: { id: jobId },
      data: {
        scheduledArrivalAt: params.command.arrivalAt,
        arrivalTimeConfirmedAt: new Date(),
      },
    })
    await db.jobStatusEvent.create({
      data: {
        jobId,
        toStatus: status,
        actorId: 'whatsapp:provider',
        actorRole: 'provider',
        notes: `Provider confirmed arrival via WhatsApp: ${params.command.raw}`,
      },
    }).catch(() => undefined)
    await notifyCustomerArrival({
      phone: lookup.customerPhone,
      customerName: lookup.customerName,
      providerName: lookup.providerName,
      category: lookup.category,
      bookingId: lookup.bookingId,
      arrivalAt: params.command.arrivalAt,
      jobId,
    })
    return {
      ok: true,
      jobId,
      toStatus: null,
      message: `Arrival time confirmed.\n\nCustomer has been notified:\n${formatTime(params.command.arrivalAt)}`,
    }
  }

  const toStatus = NEXT_STATUS[params.command.kind]
  if (!toStatus) {
    return { ok: false, reason: 'INVALID_COMMAND', message: 'Sorry, that command is not recognised.' }
  }

  if (status === toStatus) {
    return {
      ok: true,
      jobId,
      toStatus,
      message: `${confirmationFor(toStatus)}\n\nAlready recorded. No duplicate customer notification was sent.`,
    }
  }

  // Only allow forward transitions; otherwise ask the provider to use the menu
  // because non-linear transitions (e.g. completing a job not yet started) need
  // explicit confirmation.
  if (!isAllowedForwardTransition(status, toStatus)) {
    return {
      ok: false,
      reason: 'INVALID_COMMAND',
      message: `This job is currently *${friendlyStatus(status)}* — open *my jobs* to update its status.`,
    }
  }

  await transitionJob({
    jobId,
    toStatus,
    actorId: 'whatsapp:provider',
    actorRole: 'provider',
    notes: `Updated via WhatsApp text command: ${params.command.raw}`,
  })

  return {
    ok: true,
    jobId,
    toStatus,
    message: confirmationFor(toStatus),
  }
}

function isAllowedForwardTransition(current: JobStatus, target: JobStatus): boolean {
  const order: JobStatus[] = ['SCHEDULED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'PENDING_COMPLETION_CONFIRMATION']
  const currentIndex = order.indexOf(current)
  const targetIndex = order.indexOf(target)
  if (currentIndex === -1 || targetIndex === -1) return false
  return targetIndex === currentIndex + 1
}

function friendlyStatus(status: JobStatus): string {
  switch (status) {
    case 'SCHEDULED': return 'Scheduled'
    case 'EN_ROUTE': return 'On the way'
    case 'ARRIVED': return 'Arrived'
    case 'STARTED': return 'Work in progress'
    case 'PAUSED': return 'Paused'
    case 'AWAITING_APPROVAL': return 'Awaiting approval'
    case 'PENDING_COMPLETION_CONFIRMATION': return 'Awaiting customer sign-off'
    case 'COMPLETED': return 'Completed'
    default: return status
  }
}

function confirmationFor(status: JobStatus): string {
  switch (status) {
    case 'EN_ROUTE': return 'Status updated: On the way.\nCustomer notified.'
    case 'ARRIVED': return 'Status updated: Arrived.\nCustomer notified.'
    case 'STARTED': return 'Status updated: Job in progress.'
    case 'PENDING_COMPLETION_CONFIRMATION': return '✅ Marked ready for customer sign-off. Reply *my jobs* to manage further updates.'
    default: return `Status updated to ${friendlyStatus(status)}.`
  }
}

function sameMinute(left: Date, right: Date) {
  return Math.floor(left.getTime() / 60_000) === Math.floor(right.getTime() / 60_000)
}

function formatTime(value: Date) {
  return value.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function notifyCustomerArrival(params: {
  phone?: string | null
  customerName?: string | null
  providerName?: string | null
  category?: string | null
  bookingId?: string | null
  arrivalAt: Date
  jobId: string
}) {
  if (!params.phone) return
  const { sendText } = await import('./whatsapp-interactive')
  const name = params.customerName?.trim().split(/\s+/)[0] || 'there'
  const provider = params.providerName?.trim() || 'Your provider'
  const category = params.category || 'service'
  await sendText(
    params.phone,
    `Hi ${name}, ${provider} confirmed arrival for your ${category} job at ${formatTime(params.arrivalAt)}.`,
    {
      bookingId: params.bookingId ?? undefined,
      templateName: 'provider_arrival_time_confirmed',
      metadata: {
        jobId: params.jobId,
        action: 'arrival_time_confirmed',
      },
    },
  )
}

export async function completeProviderJobFromWhatsApp(params: {
  phone: string
  jobId: string
  completionNote: string
  attachmentId?: string | null
}): Promise<ProviderJobCompletionResult> {
  const note = params.completionNote.trim().slice(0, 1000)
  if (!note) {
    return { ok: false, reason: 'INVALID_STATE', message: 'Please send a short completion note.' }
  }

  const provider = await db.provider.findFirst({
    where: { phone: params.phone },
    select: { id: true },
  })
  if (!provider) {
    return { ok: false, reason: 'PROVIDER_NOT_FOUND', message: "We couldn't find your provider profile. Reply *Hi* to continue." }
  }

  const job = await db.job.findFirst({
    where: { id: params.jobId, providerId: provider.id },
    select: { id: true, status: true },
  })
  if (!job) {
    return { ok: false, reason: 'JOB_NOT_FOUND', message: 'This job is not assigned to your provider profile.' }
  }

  if (job.status === 'PENDING_COMPLETION_CONFIRMATION' || job.status === 'COMPLETED') {
    return {
      ok: true,
      jobId: job.id,
      duplicate: true,
      message: 'Job completion was already recorded. No duplicate customer notification was sent.',
    }
  }

  if (job.status !== 'STARTED') {
    return {
      ok: false,
      reason: 'INVALID_STATE',
      message: `This job is currently *${friendlyStatus(job.status)}* — reply *start* before completing it.`,
    }
  }

  await db.job.update({
    where: { id: job.id },
    data: { completionNote: note },
  })

  if (params.attachmentId) {
    await db.attachment.update({
      where: { id: params.attachmentId },
      data: {
        jobId: job.id,
        label: 'completion_photo',
        caption: note,
      },
    })
  }

  await transitionJob({
    jobId: job.id,
    toStatus: 'PENDING_COMPLETION_CONFIRMATION',
    actorId: 'whatsapp:provider',
    actorRole: 'provider',
    notes: `Completion note: ${note}`,
  })

  return {
    ok: true,
    jobId: job.id,
    duplicate: false,
    message: 'Job completed.\n\nThe customer has been notified.',
  }
}
