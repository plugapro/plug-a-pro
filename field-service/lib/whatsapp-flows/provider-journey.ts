// ─── Provider WhatsApp journey ────────────────────────────────────────────────
// Registered providers manage availability and job status through WhatsApp.
// Entry: keywords "available", "offline", "my jobs", or "provider menu"

import { sendText, sendButtons, sendList, sendCtaUrl } from '../whatsapp-interactive'
import { db } from '../db'
import { transitionJob } from '../jobs'
import { promptCustomersForNewProviderAvailability } from '../matching/customer-recontact'
import { recordAuditLog } from '../audit'
import { AUDIT_ENTITY } from '../audit-entities'
import { getProviderLeadAccessUrlByLeadId } from '../provider-lead-access'
import { normalizePhone } from '../utils'
import type { Prisma } from '@prisma/client'
import type { FlowContext, FlowResult } from './types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''
const ACTIVE_JOB_STATUSES = [
  'SCHEDULED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'PAUSED',
  'AWAITING_APPROVAL',
  'PENDING_COMPLETION_CONFIRMATION',
] as const
const ACTIVE_ACCEPTED_MATCH_STATUSES = [
  'MATCHED',
  'INSPECTION_SCHEDULED',
  'INSPECTION_COMPLETE',
  'QUOTED',
  'QUOTE_APPROVED',
] as const

export const PROVIDER_JOURNEY_TRIGGERS = [
  'available', 'online', 'im available', "i'm available", 'ek is beskikbaar',
  'offline', 'not available', 'not working', 'ek is nie beskikbaar',
  'provider menu', 'my dashboard',
]

function isProviderPaused(provider: {
  availableNow: boolean
  technicianAvailability?: {
    availabilityMode?: string | null
    availabilityState?: string | null
    breakUntil?: Date | null
  } | null
}) {
  return (
    !provider.availableNow ||
    provider.technicianAvailability?.availabilityMode === 'PAUSED' ||
    provider.technicianAvailability?.availabilityState === 'PAUSED' ||
    provider.technicianAvailability?.availabilityState === 'OFFLINE' ||
    Boolean(provider.technicianAvailability?.breakUntil && provider.technicianAvailability.breakUntil > new Date())
  )
}

function availabilityModeLabel(mode?: string | null) {
  if (mode === 'SCHEDULE') return 'Schedule-based'
  if (mode === 'PAUSED') return 'Paused'
  return 'Always available'
}

function endOfToday() {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return end
}

function toAuditJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject
}

function shortRef(id: string) {
  return id.slice(-8).toUpperCase()
}

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || 'Customer'
}

function providerPhoneVariants(phone: string) {
  const normalized = normalizePhone(phone)
  const digits = normalized.replace(/^\+/, '')
  const local = digits.startsWith('27') ? `0${digits.slice(2)}` : null
  return [...new Set([normalized, phone, digits, local].filter(Boolean) as string[])]
}

async function findProviderForWhatsApp(phone: string, include?: Prisma.ProviderInclude) {
  const normalizedPhone = normalizePhone(phone)
  const exact = await db.provider.findUnique({
    where: { phone: normalizedPhone },
    include,
  } as Prisma.ProviderFindUniqueArgs)
  if (exact) return exact as any

  const variants = providerPhoneVariants(phone)
  const matches = await (db as any).provider.findMany?.({
    where: { phone: { in: variants } },
    include,
    take: 3,
  }) ?? []

  if (matches.length > 1) {
    console.warn('[provider-journey] duplicate provider phone records detected', {
      normalizedPhone,
      variants,
      providerIds: matches.map((provider: { id: string }) => provider.id),
    })
  }

  return matches[0] ?? null
}

async function recordProviderAvailabilityAudit(params: {
  providerId: string
  action: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  channel: 'whatsapp' | 'pwa'
}) {
  await recordAuditLog({
    actorId: params.providerId,
    actorRole: 'provider',
    action: params.action,
    entityType: AUDIT_ENTITY.PROVIDER,
    entityId: params.providerId,
    before: toAuditJson(params.before),
    after: toAuditJson({
      ...params.after,
      changedChannel: params.channel,
      traceId: crypto.randomUUID().slice(0, 8),
    }),
  }).catch((error) => {
    console.error('[provider-journey] availability audit failed:', error)
  })
}

export async function handleProviderJourneyFlow(ctx: FlowContext): Promise<FlowResult> {
  switch (ctx.step) {
    case 'pj_menu':
      return handleProviderMenu(ctx)
    case 'pj_available_leads':
      return handleAvailableLeads(ctx)
    case 'pj_toggle_available':
      return handleToggleAvailable(ctx)
    case 'pj_pause_confirm':
      return handlePauseConfirm(ctx)
    case 'pj_job_list':
      return handleJobList(ctx)
    case 'pj_job_detail':
      return handleJobDetail(ctx)
    case 'pj_service_areas':
      return handleServiceAreas(ctx)
    case 'pj_profile':
      return handleProviderProfile(ctx)
    case 'pj_support':
      return handleProviderSupport(ctx)
    case 'pj_provider_status':
      return handleProviderStatus(ctx)
    case 'pj_worker_portal':
      return handleWorkerPortal(ctx)
    case 'pj_application_status':
      return handleApplicationStatus(ctx)
    case 'pj_status_confirm':
      return handleStatusConfirm(ctx)
    case 'pj_problem_report':
      return handleProblemReport(ctx)
    default:
      return handleProviderMenu(ctx)
  }
}

// ─── Provider Menu ────────────────────────────────────────────────────────────

async function handleProviderMenu(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    include: { technicianAvailability: true },
  })

  if (!provider) {
    await sendText(
      ctx.phone,
      "👷 You're not registered as a Plug A Pro provider yet.\n\nReply *join* to apply, or *Hi* for the main menu."
    )
    return { nextStep: 'done' }
  }

  const paused = isProviderPaused(provider)
  const statusLine = paused
    ? 'Status: 🔴 Leads paused'
    : 'Status: 🟢 Available for leads'

  await sendList(
    ctx.phone,
    `Welcome back, ${provider.name}.\n\n${statusLine}\n\nWhat would you like to do?`,
    [{
      title: 'Provider',
      rows: [
        { id: 'provider_my_jobs', title: 'My Jobs', description: 'Manage accepted and scheduled work' },
        { id: 'provider_available_jobs', title: 'Available Jobs', description: 'View leads you can accept' },
        { id: 'provider_check_status', title: 'Check Status', description: 'See if you can receive leads' },
        paused
          ? { id: 'provider_go_available', title: 'Go Available', description: 'Start receiving matching leads again' }
          : { id: 'provider_pause_leads', title: 'Pause Leads', description: 'Stop new leads temporarily' },
        { id: 'provider_worker_portal', title: 'Worker Portal', description: 'Manage detailed availability' },
        { id: 'provider_support', title: 'Support', description: 'Get help' },
      ],
    }],
    { buttonLabel: 'Choose Option' },
  )

  return { nextStep: 'pj_toggle_available' }
}

async function handleAvailableLeads(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  if (!provider.active || provider.status !== 'ACTIVE' || !provider.availableNow) {
    await sendButtons(
      ctx.phone,
      !provider.availableNow
        ? "Your leads are currently paused. Go available again before checking new leads."
        : "Your provider profile is not active right now, so new leads are hidden until your account is resolved.",
      [
        !provider.availableNow
          ? { id: 'provider_go_available', title: 'Go Available' }
          : { id: 'provider_status', title: 'Provider Status' },
        { id: 'provider_support', title: 'Support' },
      ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const leads = await db.lead.findMany({
    where: {
      providerId: provider.id,
      status: { in: ['SENT', 'VIEWED'] },
      expiresAt: { gt: new Date() },
    },
    include: {
      jobRequest: { include: { address: true } },
    },
    orderBy: { sentAt: 'desc' },
    take: 5,
  })

  if (leads.length === 0) {
    await sendButtons(
      ctx.phone,
      "📋 *No available leads right now.*\n\nWe'll send new job leads here when they match your services and active service areas.",
      [
        { id: 'provider_availability', title: 'Availability' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const rows = leads.map((lead) => {
    const request = lead.jobRequest
    const suburb = request.address?.suburb ?? request.address?.city ?? 'Area in request'
    return {
      id: `match_accept_${lead.id}`,
      title: request.category.slice(0, 24),
      description: `${suburb} • expires soon`.slice(0, 72),
    }
  })

  await sendList(
    ctx.phone,
    `📋 *Available Jobs*\n\nTap a lead to accept it. Expired or closed leads are not shown.`,
    [{ title: 'Open Leads', rows }],
    { buttonLabel: 'Choose Lead' },
  )

  return { nextStep: 'pj_toggle_available' }
}

// ─── Availability Toggle ──────────────────────────────────────────────────────

async function handleToggleAvailable(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'pj_view_jobs') {
    return handleJobList(ctx)
  }

  if (ctx.reply.id === 'provider_go_available' || ctx.reply.id === 'pj_go_online') {
    return setProviderAvailable(ctx)
  }

  if (ctx.reply.id === 'provider_pause_leads' || ctx.reply.id === 'pj_go_offline') {
    return promptPauseLeads(ctx)
  }

  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    include: { technicianAvailability: true },
  })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  if (ctx.reply.id === 'pj_toggle' || ctx.reply.id === 'pj_go_online' || ctx.reply.id === 'pj_go_offline') {
    // A temp-paused provider has availableNow=true but a future breakUntil — treat as offline
    const isTempPaused =
      provider.technicianAvailability?.availabilityState === 'PAUSED' &&
      provider.technicianAvailability.breakUntil != null &&
      provider.technicianAvailability.breakUntil > new Date()
    const effectivelyOnline = provider.availableNow && !isTempPaused

    const goingOnline =
      ctx.reply.id === 'pj_go_online' ? true
      : ctx.reply.id === 'pj_go_offline' ? false
      : !effectivelyOnline

    if (!goingOnline) {
      return promptPauseLeads(ctx)
    }

    await db.provider.update({ where: { id: provider.id }, data: { availableNow: true } })

    // Going online: clear any pause state so leads flow again immediately
    await db.technicianAvailability.upsert({
      where: { providerId: provider.id },
      create: {
        providerId: provider.id,
        availabilityMode: 'ALWAYS_AVAILABLE',
        availabilityState: 'AVAILABLE',
        lastUpdatedBy: provider.id,
        lastUpdatedChannel: 'whatsapp',
      },
      update: {
        availabilityMode: 'ALWAYS_AVAILABLE',
        availabilityState: 'AVAILABLE',
        nextAvailableAt: null,
        breakUntil: null,
        pausedAt: null,
        pauseReason: null,
        lastUpdatedBy: provider.id,
        lastUpdatedChannel: 'whatsapp',
        notes: null,
      },
    })
    await recordProviderAvailabilityAudit({
      providerId: provider.id,
      action: 'provider.availability.available',
      channel: 'whatsapp',
      before: {
        availableNow: provider.availableNow,
        availabilityMode: provider.technicianAvailability?.availabilityMode ?? null,
        availabilityState: provider.technicianAvailability?.availabilityState ?? null,
      },
      after: { availableNow: true, availabilityMode: 'ALWAYS_AVAILABLE', availabilityState: 'AVAILABLE' },
    })
    await promptCustomersForNewProviderAvailability(provider.id).catch((error) => {
      console.error('[provider-journey] customer recontact failed:', error)
    })

    await sendButtons(
      ctx.phone,
      `🟢 *You're available again.*\n\nWe'll send you matching leads when they come in.`,
      [
        { id: 'provider_my_jobs', title: 'My Jobs' },
        { id: 'provider_check_status', title: 'Check Status' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  // Unexpected input — re-show menu
  return handleProviderMenu(ctx)
}

async function setProviderAvailable(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    include: { technicianAvailability: true },
  })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  await db.provider.update({ where: { id: provider.id }, data: { availableNow: true } })
  await db.technicianAvailability.upsert({
    where: { providerId: provider.id },
    create: {
      providerId: provider.id,
      availabilityMode: 'ALWAYS_AVAILABLE',
      availabilityState: 'AVAILABLE',
      lastUpdatedBy: provider.id,
      lastUpdatedChannel: 'whatsapp',
    },
    update: {
      availabilityMode: 'ALWAYS_AVAILABLE',
      availabilityState: 'AVAILABLE',
      nextAvailableAt: null,
      breakUntil: null,
      pausedAt: null,
      pauseReason: null,
      lastUpdatedBy: provider.id,
      lastUpdatedChannel: 'whatsapp',
      notes: null,
    },
  })
  await recordProviderAvailabilityAudit({
    providerId: provider.id,
    action: 'provider.availability.available',
    channel: 'whatsapp',
    before: {
      availableNow: provider.availableNow,
      availabilityMode: provider.technicianAvailability?.availabilityMode ?? null,
      availabilityState: provider.technicianAvailability?.availabilityState ?? null,
    },
    after: { availableNow: true, availabilityMode: 'ALWAYS_AVAILABLE', availabilityState: 'AVAILABLE' },
  })
  await promptCustomersForNewProviderAvailability(provider.id).catch((error) => {
    console.error('[provider-journey] customer recontact failed:', error)
  })

  await sendButtons(
    ctx.phone,
    `🟢 *You're available again.*\n\nWe'll send you matching leads when they come in.`,
    [
      { id: 'provider_my_jobs', title: 'My Jobs' },
      { id: 'provider_check_status', title: 'Check Status' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function promptPauseLeads(ctx: FlowContext): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    `Pause new job leads?\n\nYou won't receive new leads while paused. Existing accepted jobs are not affected.`,
    [
      { id: 'provider_pause_today', title: 'Pause Today' },
      { id: 'provider_pause_manual', title: 'Until I Turn On' },
      { id: 'provider_pause_cancel', title: 'Cancel' },
    ],
  )
  return { nextStep: 'pj_pause_confirm' }
}

async function handlePauseConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'provider_pause_cancel' || ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (ctx.reply.id !== 'provider_pause_today' && ctx.reply.id !== 'provider_pause_manual') {
    return promptPauseLeads(ctx)
  }

  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    include: { technicianAvailability: true },
  })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const now = new Date()
  const breakUntil = ctx.reply.id === 'provider_pause_today' ? endOfToday() : null
  const pauseReason = ctx.reply.id === 'provider_pause_today'
    ? 'Paused for today from WhatsApp'
    : 'Paused until manually reactivated from WhatsApp'

  await db.provider.update({ where: { id: provider.id }, data: { availableNow: false } })
  await db.technicianAvailability.upsert({
    where: { providerId: provider.id },
    create: {
      providerId: provider.id,
      availabilityMode: 'PAUSED',
      availabilityState: 'PAUSED',
      pausedAt: now,
      breakUntil,
      pauseReason,
      lastUpdatedBy: provider.id,
      lastUpdatedChannel: 'whatsapp',
      notes: pauseReason,
    },
    update: {
      availabilityMode: 'PAUSED',
      availabilityState: 'PAUSED',
      pausedAt: now,
      breakUntil,
      pauseReason,
      lastUpdatedBy: provider.id,
      lastUpdatedChannel: 'whatsapp',
      notes: pauseReason,
    },
  })
  await recordProviderAvailabilityAudit({
    providerId: provider.id,
    action: 'provider.availability.paused',
    channel: 'whatsapp',
    before: {
      availableNow: provider.availableNow,
      availabilityMode: provider.technicianAvailability?.availabilityMode ?? null,
      availabilityState: provider.technicianAvailability?.availabilityState ?? null,
      breakUntil: provider.technicianAvailability?.breakUntil ?? null,
    },
    after: { availableNow: false, availabilityMode: 'PAUSED', availabilityState: 'PAUSED', breakUntil },
  })

  await sendButtons(
    ctx.phone,
    `🔴 *Leads paused.*\n\nYou won't receive new job leads until you go available again.\n\nExisting accepted jobs are still active.`,
    [
      { id: 'provider_go_available', title: 'Go Available' },
      { id: 'provider_my_jobs', title: 'My Jobs' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function handleServiceAreas(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    select: { serviceAreas: true, technicianServiceAreas: { select: { label: true, active: true } } },
  })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const structuredAreas = provider.technicianServiceAreas.map(
    (area) => `${area.label} — ${area.active ? 'Active pilot' : 'Coming soon'}`,
  )
  const legacyAreas = provider.serviceAreas.map((area) => `${area} — status saved`)
  const areas = structuredAreas.length ? structuredAreas : legacyAreas

  await sendButtons(
    ctx.phone,
    `📍 *Service Areas*\n\n${areas.length ? areas.join('\n') : 'No service areas saved yet.'}`,
    [
      { id: 'provider_profile', title: 'Profile' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function handleProviderProfile(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    select: {
      name: true,
      phone: true,
      status: true,
      active: true,
      verified: true,
      availableNow: true,
      skills: true,
      serviceAreas: true,
    },
  })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `👤 *Provider Profile*\n\nName: *${provider.name}*\nPhone: *${provider.phone}*\nStatus: *${provider.active ? provider.status : 'INACTIVE'}*\nAvailability: *${provider.availableNow ? 'Online' : 'Offline'}*\nServices: ${provider.skills.length ? provider.skills.join(', ') : 'Not set'}\nAreas: ${provider.serviceAreas.length ? provider.serviceAreas.join(', ') : 'Not set'}`,
    [
      { id: 'provider_service_areas', title: 'Service Areas' },
      { id: 'provider_support', title: 'Support' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function handleProviderSupport(ctx: FlowContext): Promise<FlowResult> {
  await sendButtons(
    ctx.phone,
    "🛟 *Provider Support*\n\nTell us what you need help with. A Plug A Pro team member can review your account, application, or current jobs.",
    [
      { id: 'provider_status', title: 'Provider Status' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function handleProviderStatus(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findUnique({
    where: { phone: ctx.phone },
    include: {
      technicianAvailability: true,
      schedule: { where: { active: true }, orderBy: { dayOfWeek: 'asc' } },
      technicianServiceAreas: {
        where: { active: true },
        select: { label: true },
      },
    },
  })
  if (!provider) {
    return handleApplicationStatus(ctx)
  }

  const paused = isProviderPaused(provider)
  const mode = provider.technicianAvailability?.availabilityMode ?? (
    provider.schedule.length > 0 ? 'SCHEDULE' : 'ALWAYS_AVAILABLE'
  )
  const todaySchedule = provider.schedule.find((row) => row.dayOfWeek === new Date().getDay())
  const serviceAreas = provider.technicianServiceAreas.length
    ? provider.technicianServiceAreas.map((area) => area.label).join(', ')
    : provider.serviceAreas.join(', ') || 'Not set'
  const services = provider.skills.join(', ') || 'Not set'
  const inactiveReason = provider.suspendedReason
    ? `\nReason: ${provider.suspendedReason}`
    : ''
  const suspendedUntil = provider.suspendedUntil
    ? `\nUntil: ${provider.suspendedUntil.toLocaleDateString('en-ZA')}`
    : ''
  const statusBody = paused
    ? `🔴 *You're currently paused.*\n\nYou won't receive new job leads until you go available again.`
    : mode === 'SCHEDULE'
      ? `🟡 *Your availability is schedule-based.*\n\nToday: ${todaySchedule ? `Available ${todaySchedule.startTime}–${todaySchedule.endTime}` : 'Not available'}\nCurrent status: ${provider.availableNow ? 'Available' : 'Not available'}`
      : `🟢 *You're currently available for new leads.*`

  await sendButtons(
    ctx.phone,
    `${statusBody}\n\nAvailability mode: *${availabilityModeLabel(mode)}*\nService areas: *${serviceAreas}*\nServices: *${services}*\nEmergency jobs: *${provider.technicianAvailability?.emergencyAvailable ? 'On' : 'Off'}*${inactiveReason}${suspendedUntil}\n\nYou'll receive matching leads on this WhatsApp number when available.`,
    paused
      ? [
          { id: 'provider_go_available', title: 'Go Available' },
          { id: 'provider_worker_portal', title: 'Manage Availability' },
          { id: 'back_home', title: 'Main Menu' },
        ]
      : [
          { id: 'provider_pause_leads', title: 'Pause Leads' },
          { id: 'provider_worker_portal', title: 'Manage Availability' },
          { id: 'provider_my_jobs', title: 'My Jobs' },
        ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function handleWorkerPortal(ctx: FlowContext): Promise<FlowResult> {
  const portalUrl = APP_URL ? `${APP_URL}/provider/availability` : ''
  if (!portalUrl) {
    await sendText(ctx.phone, 'Open the Worker Portal and go to Provider > Availability to manage your detailed schedule.')
    return { nextStep: 'done' }
  }

  await sendCtaUrl(
    ctx.phone,
    'Manage your detailed working hours, emergency jobs, same-day jobs, and temporary pauses in the Worker Portal.',
    'Worker Portal',
    portalUrl,
    { footer: 'WhatsApp supports quick status changes only' },
  )
  return { nextStep: 'done' }
}

async function handleApplicationStatus(ctx: FlowContext): Promise<FlowResult> {
  const application = await db.providerApplication.findFirst({
    where: { phone: ctx.phone, status: { in: ['PENDING', 'APPROVED'] } },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, name: true, status: true },
  })

  if (!application) {
    await sendText(ctx.phone, "We couldn't find a provider application for this number. Reply *join* if you'd like to apply.")
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `Hi ${application.name}, your provider application is still under review.\n\nRef: *${application.id.slice(-8).toUpperCase()}*\n\nWe'll notify you here once it's approved.`,
    [
      { id: 'provider_update_application', title: 'Update Application' },
      { id: 'provider_support', title: 'Support' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

// ─── Job List ─────────────────────────────────────────────────────────────────

async function handleJobList(ctx: FlowContext): Promise<FlowResult> {
  const traceId = crypto.randomUUID().slice(0, 8)
  const normalizedPhone = normalizePhone(ctx.phone)
  const provider = await findProviderForWhatsApp(ctx.phone, { technicianAvailability: true })
  if (!provider) {
    console.info('[provider-journey] my_jobs provider lookup failed', {
      traceId,
      inboundMessageId: ctx.reply.id ?? null,
      normalizedPhone,
    })
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const activeJobs = await db.job.findMany({
    where: {
      providerId: provider.id,
      status: { in: [...ACTIVE_JOB_STATUSES] },
    },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  address: true,
                  customer: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  const acceptedLeads = (await db.lead.findMany({
    where: {
      providerId: provider.id,
      status: 'ACCEPTED',
      jobRequest: {
        status: { notIn: ['EXPIRED', 'CANCELLED'] },
        match: {
          is: {
            providerId: provider.id,
            status: { in: [...ACTIVE_ACCEPTED_MATCH_STATUSES] },
            providerCompletedAt: null,
          },
        },
      },
    },
    include: {
      jobRequest: {
        include: {
          customer: { select: { name: true } },
          address: true,
          match: {
            include: {
              booking: { include: { job: true } },
            },
          },
        },
      },
    },
    orderBy: [{ respondedAt: 'desc' }, { sentAt: 'desc' }],
    take: 5,
  }) ?? []) as any[]

  const activeLeadWork = acceptedLeads.filter((lead: any) =>
    !lead.jobRequest?.match?.booking?.job &&
    !lead.jobRequest?.match?.providerCompletedAt
  )
  const pendingLeads = activeJobs.length === 0 && activeLeadWork.length === 0
    ? ((await db.lead.findMany({
        where: {
          providerId: provider.id,
          status: { in: ['SENT', 'VIEWED'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
        take: 1,
      }) ?? []) as any[])
    : []

  console.info('[provider-journey] my_jobs lookup', {
    traceId,
    inboundMessageId: ctx.reply.id ?? null,
    normalizedPhone,
    resolvedProviderId: provider.id,
    providerStatus: provider.status,
    queryFilters: {
      jobStatuses: ACTIVE_JOB_STATUSES,
      leadStatuses: ['ACCEPTED'],
      matchStatuses: ACTIVE_ACCEPTED_MATCH_STATUSES,
    },
    activeJobsFound: activeJobs.length,
    acceptedLeadWorkFound: activeLeadWork.length,
    pendingAvailableLeadCount: pendingLeads.length,
    refsReturned: [
      ...activeJobs.map((job: any) => shortRef(job.booking?.match?.jobRequest?.id ?? job.id)),
      ...activeLeadWork.map((lead: any) => shortRef(lead.jobRequestId)),
    ],
  })

  if (activeJobs.length === 0 && activeLeadWork.length === 0) {
    const paused = isProviderPaused(provider)
    const statusLine = paused
      ? 'Status: 🔴 Leads paused'
      : 'Status: 🟢 Available for leads'
    const pendingLeadLine = pendingLeads.length > 0
      ? '\n\nYou may have available leads waiting.'
      : ''
    await sendButtons(
      ctx.phone,
      `📋 *No active jobs right now.*\n\n${statusLine}\n\nWe'll notify you when a matching lead comes in.${pendingLeadLine}`,
      pendingLeads.length > 0 ? [
        { id: 'provider_available_jobs', title: 'Available Jobs' },
        { id: 'provider_check_status', title: 'Check Status' },
        { id: 'back_home', title: 'Main Menu' },
      ] : [
        { id: 'provider_check_status', title: 'Check Status' },
        paused
          ? { id: 'provider_go_available', title: 'Go Available' }
          : { id: 'provider_pause_leads', title: 'Pause Leads' },
        { id: 'back_home', title: 'Main Menu' },
      ]
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const statusLabel: Record<string, string> = {
    SCHEDULED: 'Scheduled',
    EN_ROUTE: 'On the way',
    ARRIVED: 'Arrived',
    STARTED: 'In progress',
    PAUSED: 'Paused',
    AWAITING_APPROVAL: 'Awaiting approval',
    PENDING_COMPLETION_CONFIRMATION: 'Awaiting customer confirmation',
  }

  const jobRows = activeJobs.slice(0, 5).map((job: any) => {
    const category = job.booking?.match?.jobRequest?.category ?? 'Job'
    const suburb = job.booking?.match?.jobRequest?.address?.suburb
    const status = statusLabel[job.status] ?? job.status
    return {
      id: `pj_job_${job.id}`,
      title: `${category}${suburb ? ` — ${suburb}` : ''}`.slice(0, 24),
      description: status,
    }
  })
  const acceptedLeadRows = activeLeadWork.slice(0, Math.max(0, 5 - jobRows.length)).map((lead: any) => {
    const category = lead.jobRequest?.category ?? 'Job'
    const suburb = lead.jobRequest?.address?.suburb
    const status = acceptedLeadStatusLabel(lead.jobRequest?.match)
    return {
      id: `pj_lead_${lead.id}`,
      title: `${category}${suburb ? ` — ${suburb}` : ''}`.slice(0, 24),
      description: status,
    }
  })

  const rows = [...jobRows, ...acceptedLeadRows]
  rows.push({ id: 'back_home', title: '🏠 Main Menu', description: 'Back to main menu' })

  await sendList(
    ctx.phone,
    `📋 *Your active jobs*\n\nChoose a job to manage.`,
    [{ title: 'Active Jobs', rows }],
    { buttonLabel: 'Choose Job' }
  )

  return { nextStep: 'pj_job_detail' }
}

function acceptedLeadStatusLabel(match: any) {
  if (!match) return 'Accepted'
  if (match.providerCompletedAt) return 'Completed'
  if (match.providerStartedAt) return 'In progress'
  if (match.providerArrivedAt) return 'Arrived'
  if (match.providerOnTheWayAt) return 'On the way'
  if (match.plannedArrivalStart) return 'Scheduled'
  if (match.customerContactedAt) return 'Customer contacted'
  return 'Accepted'
}

function acceptedLeadNextStep(match: any) {
  if (!match?.plannedArrivalStart) return 'Confirm arrival time'
  if (!match?.customerContactedAt) return 'Contact customer'
  if (!match?.providerOnTheWayAt) return 'Mark on the way'
  if (!match?.providerArrivedAt) return 'Mark arrived'
  if (!match?.providerStartedAt) return 'Start job'
  if (!match?.providerCompletedAt) return 'Complete job'
  return 'Review job'
}

// ─── Job Detail & Status Update ───────────────────────────────────────────────

async function handleJobDetail(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (ctx.reply.id?.startsWith('pj_lead_')) {
    return handleAcceptedLeadDetail(ctx, ctx.reply.id.replace('pj_lead_', ''))
  }

  if (!ctx.reply.id?.startsWith('pj_job_')) {
    return handleJobList(ctx)
  }

  const jobId = ctx.reply.id.replace('pj_job_', '')

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: { include: { address: true } },
            },
          },
        },
      },
    },
  })

  if (!job) {
    await sendText(ctx.phone, "Job not found. Reply *my jobs* to see your active jobs.")
    return { nextStep: 'done' }
  }

  const jobAny = job as any
  const category = jobAny.booking?.match?.jobRequest?.category ?? 'Job'
  const address = jobAny.booking?.match?.jobRequest?.address
  const addressStr = address ? `${address.street}, ${address.suburb}` : 'Address on file'

  const statusLabel: Record<string, string> = {
    SCHEDULED: '📅 Scheduled',
    EN_ROUTE: '🚗 On the way',
    ARRIVED: '📍 Arrived',
    STARTED: '🔧 In progress',
    PAUSED: '⏸ Paused',
    AWAITING_APPROVAL: '⌛ Awaiting approval',
  }

  const currentStatus = statusLabel[(job as any).status] ?? (job as any).status
  const nextSteps = getNextStatusOptions((job as any).status)

  if (nextSteps.length === 0) {
    await sendText(
      ctx.phone,
      `🔧 *${category}*\n📍 ${addressStr}\n${currentStatus}\n\nNo more status updates for this job. Reply *my jobs* to see all jobs.`
    )
    return { nextStep: 'done' }
  }

  // Build button IDs: pj_upd_<jobId>_<newStatus>
  // WhatsApp button title max 20 chars — keep labels short
  const buttons = nextSteps.map((s) => ({
    id: `pj_upd_${jobId}_${s.id}`,
    title: s.label,
  }))

  await sendButtons(
    ctx.phone,
    `🔧 *${category}*\n📍 ${addressStr}\nCurrent: ${currentStatus}\n\nUpdate status to:`,
    buttons
  )

  return { nextStep: 'pj_status_confirm', nextData: { activeJobId: jobId } }
}

async function handleAcceptedLeadDetail(ctx: FlowContext, leadId: string): Promise<FlowResult> {
  const traceId = crypto.randomUUID().slice(0, 8)
  const normalizedPhone = normalizePhone(ctx.phone)
  const provider = await findProviderForWhatsApp(ctx.phone)
  if (!provider) {
    console.info('[provider-journey] lead_detail provider lookup failed', {
      traceId,
      normalizedPhone,
      leadId,
      inboundMessageId: ctx.reply.id ?? null,
    })
    await sendText(ctx.phone, "You're not registered as a provider.")
    return { nextStep: 'done' }
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      jobRequest: {
        include: {
          customer: { select: { name: true } },
          address: true,
          match: true,
        },
      },
    },
  })

  const match = (lead as any)?.jobRequest?.match
  if (
    !lead ||
    lead.providerId !== provider.id ||
    lead.status !== 'ACCEPTED' ||
    !match ||
    match.providerId !== provider.id ||
    match.status === 'CANCELLED' ||
    lead.jobRequest.status === 'EXPIRED' ||
    lead.jobRequest.status === 'CANCELLED'
  ) {
    await sendText(ctx.phone, "⚠️ This accepted job is no longer active or doesn't belong to you.")
    return { nextStep: 'done' }
  }

  const category = lead.jobRequest.category
  const address = lead.jobRequest.address
  const suburb = address?.suburb ?? 'Area on ticket'
  const customer = firstName(lead.jobRequest.customer?.name)
  const status = acceptedLeadStatusLabel(match)
  const nextStep = acceptedLeadNextStep(match)
  console.info('[provider-journey] lead_detail resolved', {
    traceId,
    normalizedPhone,
    resolvedProviderId: provider.id,
    leadId: lead.id,
    jobRequestRef: shortRef(lead.jobRequestId),
    leadStatus: lead.status,
    matchStatus: match.status,
    statusLabel: status,
    nextStep,
  })
  const leadUrl = await getProviderLeadAccessUrlByLeadId(lead.id)
  const body =
    `📋 *${category} — ${suburb}*\n\n` +
    `Customer: *${customer}*\n` +
    `Ref: *${shortRef(lead.jobRequestId)}*\n` +
    `Status: *${status}*\n` +
    `Next step: *${nextStep}*\n\n` +
    `Open the job to view customer details, photos, contact options, and status actions.`

  if (leadUrl) {
    await sendCtaUrl(
      ctx.phone,
      body,
      'View Job',
      leadUrl,
      { footer: 'Secure link for this accepted job only' },
    )
  } else {
    await sendText(ctx.phone, body)
  }

  return { nextStep: 'done' }
}

function getNextStatusOptions(currentStatus: string): Array<{ id: string; label: string }> {
  const transitions: Record<string, Array<{ id: string; label: string }>> = {
    SCHEDULED:         [{ id: 'EN_ROUTE', label: '🚗 On My Way' }],
    EN_ROUTE:          [{ id: 'ARRIVED', label: "📍 I've Arrived" }],
    ARRIVED:           [{ id: 'STARTED', label: '🔧 Start Work' }],
    STARTED:           [{ id: 'PENDING_COMPLETION_CONFIRMATION', label: '✅ Ready for Sign-Off' }, { id: 'PAUSED', label: '⏸ Pause' }],
    PAUSED:            [{ id: 'STARTED', label: '🔧 Resume Work' }],
    AWAITING_APPROVAL: [],
    PENDING_COMPLETION_CONFIRMATION: [],
  }
  return transitions[currentStatus] ?? []
}

async function handleStatusConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  if (!ctx.reply.id?.startsWith('pj_upd_')) {
    return { nextStep: 'pj_status_confirm' }
  }

  // Parse: pj_upd_<jobId>_<newStatus>
  // cuid IDs do not contain underscores, so the first underscore after the prefix
  // separates the job ID from the target status.
  const withoutPrefix = ctx.reply.id.replace('pj_upd_', '')
  const firstUnderscore = withoutPrefix.indexOf('_')
  const jobId = withoutPrefix.slice(0, firstUnderscore)
  const newStatus = withoutPrefix.slice(firstUnderscore + 1)

  const provider = await db.provider.findUnique({ where: { phone: ctx.phone } })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider.")
    return { nextStep: 'done' }
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: { include: { customer: true } },
            },
          },
        },
      },
    },
  })

  const jobAny = job as any
  if (!jobAny || jobAny.providerId !== provider.id) {
    await sendText(ctx.phone, "⚠️ This job is no longer available or doesn't belong to you.")
    return { nextStep: 'done' }
  }

  await transitionJob({
    jobId,
    toStatus: newStatus as any,
    actorId: provider.id,
    actorRole: 'provider',
    notes: 'Updated via WhatsApp by provider',
  })

  const statusMessages: Record<string, string> = {
    EN_ROUTE:  '🚗 Status updated — *On My Way*!\n\nThe customer has been notified you are en route.',
    ARRIVED:   "📍 Status updated — *Arrived*!\n\nThe customer has been notified you're at the location.",
    STARTED:   '🔧 Status updated — *Work Started*!\n\nUpdate to ✅ Done when finished.',
    PAUSED:    '⏸ Job paused.\n\nReply *my jobs* to resume when ready.',
    PENDING_COMPLETION_CONFIRMATION: `✅ *Marked ready for customer sign-off!*\n\nThe customer has been asked to confirm completion.`,
  }

  await sendButtons(
    ctx.phone,
    statusMessages[newStatus] ?? `✅ Status updated to ${newStatus}.`,
    [
      { id: 'pj_view_jobs', title: '📋 My Jobs' },
      { id: 'back_home', title: '🏠 Main Menu' },
    ]
  )

  return { nextStep: 'pj_toggle_available' }
}

async function handleProblemReport(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  await sendText(
    ctx.phone,
    `🚨 *Report a Problem*\n\nPlease reply with a description of the issue and we'll follow up within 2 hours.\n\nInclude:\n• Your job reference number\n• What went wrong\n\nOr call: ${process.env.SUPPORT_WHATSAPP_NUMBER ?? 'our support line'}`
  )
  return { nextStep: 'done' }
}
