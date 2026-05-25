// ─── Provider WhatsApp journey ────────────────────────────────────────────────
// Registered providers manage availability and job status through WhatsApp.
// Entry: keywords "available", "offline", "my jobs", or "provider menu"

import { sendText, sendButtons, sendList, sendCtaUrl } from '../whatsapp-interactive'
import { sendCustomerRunningLateNotification, sendProviderInvoiceTemplate } from '../whatsapp'
import { redeemVoucher } from '../voucher-redemption'
import { mapVoucherRedemptionErrorToMessage } from '../vouchers'
import { createPayatTopUpIntent } from '../provider-credit-payment-intents'
import { notifyProviderPaymentIntentCreated } from '../provider-wallet-notifications'
import { logOutboundMessage } from '../message-events'
import { db } from '../db'
import { transitionJob } from '../jobs'
import { promptCustomersForNewProviderAvailability } from '../matching/customer-recontact'
import { recordAuditLog } from '../audit'
import { AUDIT_ENTITY } from '../audit-entities'
import { getProviderSignedJobHandoverUrlByLeadId } from '../provider-lead-access'
import { getProviderWalletBalanceReadOnly } from '../provider-wallet'
import { buildProviderCreditSummaryMessage, creditCountLabel, getPublicAppUrl, providerCreditBreakdownLabel } from '../provider-credit-copy'
import { issueProviderIdentityVerificationLink } from '../identity-verification/link'
import {
  buildHighAssuranceCreditVerificationWhere,
  isProviderEligibleForCredits,
} from '../identity-verification/credit-gate'
import { ctaLabelFor } from '../whatsapp-copy'
import { normaliseLocationDisplayName } from '../location-format'
import { normalizePhone } from '../utils'
import { phoneLookupVariants } from '../whatsapp-identity'
import { handleWhatsAppIdentityVerificationFlow } from './identity-verification'
import type { Prisma } from '@prisma/client'
import type { FlowContext, FlowResult } from './types'

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
  'verify', 'verification', 'verify identity', 'complete verification',
  'pause', 'break', 'back later', 'back in 1 hour', 'back in 2 hours', 'back in an hour', 'back tomorrow',
  // M5-T3: running-late
  'running late', 'delayed', 'late', 'stuck in traffic',
  // M5-T4: dispute
  'dispute', 'issue with job', 'raise issue',
  // M5-T5: invoice
  'invoice', 'send invoice', 'receipt',
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

function providerFirstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || 'Provider'
}

function providerApplicationRef(id?: string | null) {
  return id ? id.slice(-8).toUpperCase() : 'Pending'
}

function providerApplicationStatusLabel(status?: string | null) {
  switch (status) {
    case 'PENDING':
      return 'Under review'
    case 'MORE_INFO_REQUIRED':
      return 'More details needed'
    case 'APPROVED':
      return 'Approved'
    case 'REJECTED':
      return 'Not approved'
    case 'CANCELLED':
      return 'Cancelled'
    default:
      return 'Unknown'
  }
}

function providerApplicationStatusSentence(status?: string | null) {
  switch (status) {
    case 'APPROVED':
      return 'approved'
    case 'REJECTED':
      return 'not approved'
    case 'MORE_INFO_REQUIRED':
      return 'waiting for more details'
    case 'CANCELLED':
      return 'cancelled'
    case 'PENDING':
    default:
      return 'waiting for review'
  }
}

function isProviderInactive(provider: {
  active?: boolean | null
  status?: string | null
  suspendedUntil?: Date | null
}) {
  return (
    provider.active === false ||
    ['SUSPENDED', 'ARCHIVED', 'BANNED'].includes(provider.status ?? '') ||
    Boolean(provider.suspendedUntil && provider.suspendedUntil > new Date())
  )
}

function isProviderPendingReview(provider: {
  active?: boolean | null
  status?: string | null
}) {
  return ['APPLICATION_PENDING', 'UNDER_REVIEW'].includes(provider.status ?? '')
}

function safeProviderStatusReason(reason?: string | null) {
  return reason?.trim() ? `\nReason: ${reason.trim()}` : ''
}

function maskPhoneForJourneyLog(phone: string) {
  const normalized = normalizePhone(phone)
  return normalized.length > 4 ? `***${normalized.slice(-4)}` : '***'
}

async function providerCreditBalanceLine(providerId: string) {
  const balance = await getProviderWalletBalanceReadOnly(providerId)
  return `Credits balance: *${creditCountLabel(balance.totalCreditBalance)}* (${providerCreditBreakdownLabel(balance)})`
}

async function providerCreditSummary(providerId: string) {
  const balance = await getProviderWalletBalanceReadOnly(providerId)
  return buildProviderCreditSummaryMessage(balance)
}

async function issueIdentityVerificationLinkForWhatsApp(providerId: string) {
  try {
    return await issueProviderIdentityVerificationLink({
      providerId,
      channel: 'PWA',
    })
  } catch (error) {
    console.error('[provider-journey] identity verification link issue failed', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function findProviderForWhatsApp(phone: string, include?: Prisma.ProviderInclude) {
  const normalizedPhone = normalizePhone(phone)
  const exact = await db.provider.findUnique({
    where: { phone: normalizedPhone },
    include,
  } as Prisma.ProviderFindUniqueArgs)
  if (exact) return exact as any

  const variants = phoneLookupVariants(phone)
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

async function findLatestProviderApplicationForWhatsApp(phone: string, providerId?: string | null) {
  const phoneVariants = phoneLookupVariants(phone)
  const orFilters: Prisma.ProviderApplicationWhereInput[] = [
    { phone: { in: phoneVariants } },
  ]
  if (providerId) {
    orFilters.push({ providerId })
  }

  return await db.providerApplication.findFirst({
    where: { OR: orFilters },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      providerId: true,
      notes: true,
      submittedAt: true,
      skills: true,
      serviceAreas: true,
      availability: true,
      callOutFee: true,
      hourlyRate: true,
    },
  })
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
    case 'pj_credits':
      return handleProviderCredits(ctx)
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
    case 'pj_verify_identity':
      return handleVerifyIdentity(ctx)
    case 'pj_identity_start':
    case 'pj_identity_consent':
    case 'pj_identity_basis':
    case 'pj_identity_identifier':
    case 'pj_identity_document':
    case 'pj_identity_selfie':
      return handleWhatsAppIdentityVerificationFlow(ctx)
    case 'pj_running_late':
      return handleRunningLateFlow(ctx.phone)
    case 'pj_dispute_collect':
      return handleProviderDisputeCollect(ctx)
    case 'pj_invoice':
      return handleInvoiceFlow(ctx.phone)
    case 'pj_topup_select_amount':
      return handleTopUpSelectAmount(ctx)
    case 'pj_topup_payat_created':
    case 'pj_topup_eft_created':
      return handleProviderMenu(ctx)
    case 'pj_redeem_voucher':
      return handleVoucherRedeemPrompt(ctx)
    case 'pj_redeem_voucher_awaiting_code':
      return handleVoucherCodeEntry(ctx)
    default:
      return handleProviderMenu(ctx)
  }
}

// ─── Provider Menu ────────────────────────────────────────────────────────────

async function handleProviderMenu(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone, { technicianAvailability: true })

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
  const creditLine = await providerCreditBalanceLine(provider.id)

  await sendList(
      ctx.phone,
    `Welcome back, ${provider.name}.\n\n${statusLine}\n${creditLine}\n\nPreviewing and showing interest is free. You spend 1 credit only when a customer selects you and you accept the job.\n\nWhat would you like to do?`,
    [{
      title: 'Provider',
      rows: [
        { id: 'provider_check_status', title: 'View Credits', description: 'Check balance and credit history' },
        { id: 'provider_available_jobs', title: 'View Opportunities', description: 'Review safe job previews' },
        { id: 'provider_my_jobs', title: 'View Active Jobs', description: 'Manage accepted and scheduled work' },
        paused
          ? { id: 'provider_go_available', title: 'Update Availability', description: 'Start receiving matching leads again' }
          : { id: 'provider_pause_leads', title: 'Update Availability', description: 'Stop new leads temporarily' },
        { id: 'provider_profile', title: 'Update Profile', description: 'Review services and service areas' },
        { id: 'provider_support', title: 'Contact Support', description: 'Get help' },
      ],
    }],
    { buttonLabel: 'Choose Option' },
  )

  return { nextStep: 'pj_toggle_available' }
}

async function handleAvailableLeads(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone)
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
    const creditLine = await providerCreditBalanceLine(provider.id)
    await sendButtons(
      ctx.phone,
      `📋 *No available leads right now.*\n\n${creditLine}\n\nWe'll send new job leads here when they match your services and active service areas.`,
      [
        { id: 'provider_availability', title: 'Availability' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const rows = leads.map((lead) => {
    const request = lead.jobRequest
    const suburb = normaliseLocationDisplayName(request.address?.suburb ?? request.address?.city) || 'Area in request'
    return {
      id: `match_accept_${lead.id}`,
      title: request.category.slice(0, 24),
      description: `${suburb} • expires soon`.slice(0, 72),
    }
  })

  const creditLine = await providerCreditBalanceLine(provider.id)
  await sendList(
    ctx.phone,
    `📋 *Available Jobs*\n\n${creditLine}\n\nAccepting an eligible lead uses 1 credit. Expired or closed leads are not shown.`,
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

  const provider = await findProviderForWhatsApp(ctx.phone, { technicianAvailability: true })
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

  if (ctx.reply.id === 'provider_topup') return { nextStep: 'pj_topup_select_amount' }

  // Unexpected input — re-show menu
  return handleProviderMenu(ctx)
}

async function setProviderAvailable(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone, { technicianAvailability: true })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  await db.$transaction(async (tx) => {
    await tx.provider.update({ where: { id: provider.id }, data: { availableNow: true } })
    await tx.technicianAvailability.upsert({
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
  return handlePauseFlow(ctx.phone)
}

export async function handlePauseFlow(phone: string): Promise<FlowResult> {
  await sendButtons(
    phone,
    `How long do you need a break? Your leads will be paused until you resume.`,
    [
      { id: 'pause_30m', title: '30 minutes' },
      { id: 'pause_1h', title: '1 hour' },
      { id: 'pause_2h', title: '2 hours' },
      { id: 'pause_today', title: 'Rest of today' },
      { id: 'pause_indefinite', title: 'Until I turn on' },
    ],
  )
  return { nextStep: 'pj_pause_confirm' }
}

function getPauseDuration(id: string): { breakUntil: Date | null; label: string; reason: string } | null {
  const now = new Date()
  if (id === 'pause_30m') {
    const t = new Date(now.getTime() + 30 * 60 * 1000)
    return {
      breakUntil: t,
      label: `until ${t.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`,
      reason: 'Paused for 30 minutes from WhatsApp',
    }
  }
  if (id === 'pause_1h') {
    const t = new Date(now.getTime() + 60 * 60 * 1000)
    return {
      breakUntil: t,
      label: `until ${t.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`,
      reason: 'Paused for 1 hour from WhatsApp',
    }
  }
  if (id === 'pause_2h') {
    const t = new Date(now.getTime() + 120 * 60 * 1000)
    return {
      breakUntil: t,
      label: `until ${t.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`,
      reason: 'Paused for 2 hours from WhatsApp',
    }
  }
  if (id === 'pause_today' || id === 'provider_pause_today') {
    const t = endOfToday()
    return {
      breakUntil: t,
      label: 'for the rest of today',
      reason: 'Paused for today from WhatsApp',
    }
  }
  if (id === 'pause_indefinite' || id === 'provider_pause_manual') {
    return {
      breakUntil: null,
      label: 'until you turn back on',
      reason: 'Paused until manually reactivated from WhatsApp',
    }
  }
  return null
}

async function handlePauseConfirm(ctx: FlowContext): Promise<FlowResult> {
  if (ctx.reply.id === 'provider_pause_cancel' || ctx.reply.id === 'back_home') {
    return { nextStep: 'done' }
  }

  const duration = ctx.reply.id ? getPauseDuration(ctx.reply.id) : null
  if (!duration) {
    return promptPauseLeads(ctx)
  }

  const provider = await findProviderForWhatsApp(ctx.phone, { technicianAvailability: true })
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const now = new Date()
  const { breakUntil, label, reason: pauseReason } = duration

  await db.$transaction(async (tx) => {
    await tx.provider.update({ where: { id: provider.id }, data: { availableNow: false } })
    await tx.technicianAvailability.upsert({
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
    `🔴 *You're paused ${label}.*\n\nReply *available* to resume anytime.\n\nExisting accepted jobs are still active.`,
    [
      { id: 'provider_go_available', title: 'Go Available' },
      { id: 'provider_my_jobs', title: 'My Jobs' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  return { nextStep: 'pj_toggle_available' }
}

async function handleServiceAreas(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findFirst({
    where: { phone: { in: phoneLookupVariants(ctx.phone) } },
    select: { serviceAreas: true, technicianServiceAreas: { select: { label: true, active: true } } },
    orderBy: { updatedAt: 'desc' },
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
  const provider = await db.provider.findFirst({
    where: { phone: { in: phoneLookupVariants(ctx.phone) } },
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
    orderBy: { updatedAt: 'desc' },
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

async function handleProviderCredits(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone)
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  let creditSummary = 'Credits balance: not available yet.'
  try {
    creditSummary = await providerCreditSummary(provider.id)
  } catch {
    // balance unavailable — send best-effort message
  }

  await sendButtons(
    ctx.phone,
    creditSummary,
    [
      { id: 'provider_topup', title: 'Top Up Credits' },
      { id: 'back_home', title: 'Main Menu' },
    ],
  )
  const creditHistoryUrl = getPublicAppUrl('/provider/credits')
  if (creditHistoryUrl) {
    await sendCtaUrl(
      ctx.phone,
      'Credits history is available below.',
      ctaLabelFor('credit_history'),
      creditHistoryUrl,
      undefined,
      { templateName: 'interactive:provider_credit_history_cta' },
    )
  }
  return { nextStep: 'pj_toggle_available' }
}

async function handleProviderStatus(ctx: FlowContext): Promise<FlowResult> {
  const traceId = crypto.randomUUID().slice(0, 8)
  const provider = await findProviderForWhatsApp(ctx.phone, {
    technicianAvailability: true,
    schedule: { where: { active: true }, orderBy: { dayOfWeek: 'asc' } },
    technicianServiceAreas: {
      where: { active: true },
      select: { label: true },
    },
  })
  const application = await findLatestProviderApplicationForWhatsApp(ctx.phone, provider?.id)

  console.info('[provider-journey] provider status requested', {
    traceId,
    phone: maskPhoneForJourneyLog(ctx.phone),
    providerId: provider?.id ?? null,
    applicationId: application?.id ?? null,
    applicationStatus: application?.status ?? null,
    profileStatus: provider?.status ?? null,
    profileActive: provider?.active ?? null,
    actionId: ctx.reply.id ?? null,
  })

  if (!provider) {
    return handleApplicationStatus(ctx, application)
  }

  // Root cause: Provider Status used to enter the active-provider availability
  // and credits path immediately. Pending/inactive providers can legitimately
  // lack wallet, verification, or availability records, so explain application
  // and profile state first and only use active-provider services after that.
  if (
    isProviderPendingReview(provider) ||
    (isProviderInactive(provider) && application && ['PENDING', 'MORE_INFO_REQUIRED'].includes(application.status))
  ) {
    const needsMoreInfo = application?.status === 'MORE_INFO_REQUIRED'
    await sendButtons(
      ctx.phone,
      needsMoreInfo
        ? `Hi ${providerFirstName(provider.name ?? application?.name)}, your provider application needs a few more details before review can continue.\n\nRef: *${providerApplicationRef(application?.id)}*\nStatus: *${providerApplicationStatusLabel(application?.status)}*\n\nYour provider profile will stay inactive until approval is complete.`
        : `Hi ${providerFirstName(provider.name ?? application?.name)}, your provider application is waiting for review.\n\nRef: *${providerApplicationRef(application?.id)}*\nStatus: *${providerApplicationStatusLabel(application?.status ?? 'PENDING')}*\n\nYour provider profile will stay inactive until approval is complete. You won't receive job leads yet. We'll update you here once reviewed.`,
      needsMoreInfo
        ? [
            { id: 'provider_update_application', title: 'Complete details' },
            { id: 'provider_status_retry', title: 'Check again' },
            { id: 'back_home', title: 'Main Menu' },
          ]
        : [
            { id: 'provider_status_retry', title: 'Check again' },
            { id: 'provider_update_application', title: 'Complete profile' },
            { id: 'back_home', title: 'Main Menu' },
          ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  if (application?.status === 'REJECTED') {
    await sendButtons(
      ctx.phone,
      `Hi ${providerFirstName(provider.name ?? application.name)}, your provider application was not approved.\n\nRef: *${providerApplicationRef(application.id)}*${safeProviderStatusReason(application.notes)}\n\nIf you believe this is incorrect, contact support and we can review it.`,
      [
        { id: 'provider_support', title: 'Support' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  if (['SUSPENDED', 'ARCHIVED', 'BANNED'].includes(provider.status ?? '')) {
    await sendButtons(
      ctx.phone,
      `Hi ${providerFirstName(provider.name)}, your provider profile is inactive because it has been ${provider.status === 'SUSPENDED' ? 'suspended' : 'disabled'}.\n\nYou won't receive job leads until support reviews the account.${safeProviderStatusReason(provider.suspendedReason)}`,
      [
        { id: 'provider_support', title: 'Support' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'pj_toggle_available' }
  }

  const paused = isProviderPaused(provider)
  const mode = provider.technicianAvailability?.availabilityMode ?? (
    provider.schedule.length > 0 ? 'SCHEDULE' : 'ALWAYS_AVAILABLE'
  )
  const todaySchedule = provider.schedule.find((row: { dayOfWeek: number }) => row.dayOfWeek === new Date().getDay())
  const serviceAreas = provider.technicianServiceAreas.length
    ? provider.technicianServiceAreas.map((area: { label: string }) => area.label).join(', ')
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
  let creditSummary = 'Credits balance: not available yet.'
  try {
    creditSummary = await providerCreditSummary(provider.id)
  } catch (error) {
    console.warn('[provider-journey] provider status credits unavailable', {
      traceId,
      phone: maskPhoneForJourneyLog(ctx.phone),
      providerId: provider.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  await sendButtons(
    ctx.phone,
    `${statusBody}\n\n${creditSummary}\n\nApplication status: *${providerApplicationStatusLabel(application?.status)}*\nProvider profile: *${provider.active ? provider.status : 'Inactive'}*\nAvailability mode: *${availabilityModeLabel(mode)}*\nService areas: *${serviceAreas}*\nServices: *${services}*\nEmergency jobs: *${provider.technicianAvailability?.emergencyAvailable ? 'On' : 'Off'}*${inactiveReason}${suspendedUntil}\n\nYou'll receive matching leads on this WhatsApp number when approved, active, and available.`,
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
  const creditHistoryUrl = getPublicAppUrl('/provider/credits')
  if (creditHistoryUrl) {
    await sendCtaUrl(
      ctx.phone,
      'Credits history is available below.',
      ctaLabelFor('credit_history'),
      creditHistoryUrl,
      undefined,
      { templateName: 'interactive:provider_credit_history_cta' },
    )
  }
  return { nextStep: 'pj_toggle_available' }
}

async function handleWorkerPortal(ctx: FlowContext): Promise<FlowResult> {
  const portalUrl = getPublicAppUrl('/provider/availability')
  if (!portalUrl) {
    await sendText(ctx.phone, 'Open the Worker Portal and go to Provider > Availability to manage your detailed schedule.')
    return { nextStep: 'done' }
  }

  await sendCtaUrl(
    ctx.phone,
    'Manage your detailed working hours, emergency jobs, same-day jobs, and temporary pauses in the Worker Portal.',
    ctaLabelFor('worker_portal'),
    portalUrl,
    { footer: 'WhatsApp supports quick status changes only' },
  )
  return { nextStep: 'done' }
}

async function handleApplicationStatus(
  ctx: FlowContext,
  resolvedApplication?: Awaited<ReturnType<typeof findLatestProviderApplicationForWhatsApp>> | null,
): Promise<FlowResult> {
  const application = resolvedApplication ?? await findLatestProviderApplicationForWhatsApp(ctx.phone)

  if (!application) {
    await sendButtons(
      ctx.phone,
      "We couldn't find a provider application for this WhatsApp number.",
      [
        { id: 'reg_start', title: 'Apply as provider' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'done' }
  }

  await sendButtons(
    ctx.phone,
    `Hi ${providerFirstName(application.name)}, your provider application is ${providerApplicationStatusSentence(application.status)}.\n\nRef: *${providerApplicationRef(application.id)}*\nStatus: *${providerApplicationStatusLabel(application.status)}*\n\nYour provider profile will stay inactive until approval is complete. We'll notify you here once reviewed.`,
    [
      { id: 'provider_status_retry', title: 'Check again' },
      { id: 'provider_update_application', title: 'Complete profile' },
      { id: 'back_home', title: 'Main Menu' },
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
      isTestJob: Boolean(provider.isTestUser),
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
      isTestLead: Boolean(provider.isTestUser),
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
          isTestLead: Boolean(provider.isTestUser),
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
    const suburb = normaliseLocationDisplayName(job.booking?.match?.jobRequest?.address?.suburb)
    const status = statusLabel[job.status] ?? job.status
    return {
      id: `pj_job_${job.id}`,
      title: `${category}${suburb ? ` — ${suburb}` : ''}`.slice(0, 24),
      description: status,
    }
  })
  const acceptedLeadRows = activeLeadWork.slice(0, Math.max(0, 5 - jobRows.length)).map((lead: any) => {
    const category = lead.jobRequest?.category ?? 'Job'
    const suburb = normaliseLocationDisplayName(lead.jobRequest?.address?.suburb)
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
  const addressStr = address ? `${address.street}, ${normaliseLocationDisplayName(address.suburb)}` : 'Address on file'

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
  const suburb = normaliseLocationDisplayName(address?.suburb) || 'Area on ticket'
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
  const leadUrl = await getProviderSignedJobHandoverUrlByLeadId(lead.id)
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
      ctaLabelFor('view_job'),
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

  const provider = await findProviderForWhatsApp(ctx.phone)
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

async function handleVerifyIdentity(ctx: FlowContext): Promise<FlowResult> {
  const provider = await db.provider.findFirst({
    where: { phone: { in: phoneLookupVariants(ctx.phone) } },
    select: { id: true, kycStatus: true },
    orderBy: { updatedAt: 'desc' },
  })

  if (!provider) {
    // Could be an applicant — direct them to support
    await sendButtons(
      ctx.phone,
      "You're not yet registered as an active provider. Once your application is approved, you can complete identity verification in the Worker Portal.",
      [{ id: 'provider_support', title: 'Support' }],
    )
    return { nextStep: 'done' }
  }

  const highAssuranceVerification = await db.providerIdentityVerification.findFirst({
    where: buildHighAssuranceCreditVerificationWhere(provider.id),
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })

  if (provider.kycStatus === 'VERIFIED' && highAssuranceVerification) {
    await sendButtons(
      ctx.phone,
      '✅ *Identity already verified*\n\nYour identity has been confirmed. No further action is needed.',
      [{ id: 'back_home', title: 'Main Menu' }],
    )
    return { nextStep: 'done' }
  }

  const statusLabel: Record<string, string> = {
    NOT_STARTED: 'Not started',
    IN_PROGRESS: 'In progress',
    SUBMITTED: 'Under review',
    REJECTED: 'Rejected — resubmission required',
    EXPIRED: 'Expired',
  }
  const status = provider.kycStatus === 'VERIFIED'
    ? 'Manual review complete — secure liveness step required for buying credits'
    : statusLabel[(provider.kycStatus as string) ?? 'NOT_STARTED'] ?? (provider.kycStatus ?? 'Not started')
  const link = await issueIdentityVerificationLinkForWhatsApp(provider.id)
  const portalUrl = link?.verificationUrl ?? getPublicAppUrl('/provider/verification')
  const identityCtaLabel = ctaLabelFor('identity_verification')

  if (portalUrl) {
    console.info('[provider-journey] identity verification CTA prepared', {
      providerId: provider.id,
      verificationSessionId: link?.verificationId ?? null,
      verificationStatus: link?.status ?? null,
      outboundMessageType: 'interactive:cta_url',
      buttonText: identityCtaLabel,
      buttonTextLength: identityCtaLabel.length,
    })
    try {
      await sendCtaUrl(
        ctx.phone,
        `🪪 *Identity Verification*\n\nStatus: *${status}*\n\nComplete or update your identity verification in the Worker Portal. The secure liveness step is required before buying credits.`,
        identityCtaLabel,
        portalUrl,
      )
    } catch (error) {
      console.error('[provider-journey] identity verification CTA send failed', {
        providerId: provider.id,
        verificationSessionId: link?.verificationId ?? null,
        verificationStatus: link?.status ?? null,
        outboundMessageType: 'interactive:cta_url',
        buttonText: identityCtaLabel,
        buttonTextLength: identityCtaLabel.length,
        error: error instanceof Error ? error.message : String(error),
      })
      await sendButtons(
        ctx.phone,
        'We could not send the secure identity link right now. Please tap Try again to request a new link.',
        [
          { id: 'provider_verify_identity', title: 'Try again' },
          { id: 'back_home', title: 'Main Menu' },
        ],
      )
      return { nextStep: 'done' }
    }
    await sendButtons(
      ctx.phone,
      'WhatsApp fallback: If the secure page will not open because of data limits, you can submit documents here for manual review. This is lower assurance and buying credits still needs the secure PWA liveness step.',
      [
        { id: 'iv_start_whatsapp', title: 'Use WhatsApp' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
  } else {
    await sendButtons(
      ctx.phone,
      `🪪 *Identity Verification*\n\nStatus: *${status}*\n\nTo complete verification, log in to the Worker Portal and navigate to Provider > Verification.`,
      [{ id: 'back_home', title: 'Main Menu' }],
    )
  }
  return { nextStep: 'done' }
}

// ─── M5-T3: Running-late comms ────────────────────────────────────────────────

export async function handleRunningLateFlow(phone: string): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(phone)
  if (!provider) {
    await sendText(phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  // Find active job with customer data
  const activeJob = await db.job.findFirst({
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
                include: { customer: { select: { phone: true, name: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!activeJob) {
    await sendText(phone, "No active job found. If you have a job in progress, reply *my jobs* for details.")
    return { nextStep: 'done' }
  }

  const jobAny = activeJob as any
  const category = jobAny.booking?.match?.jobRequest?.category ?? 'service'
  const customerPhone = jobAny.booking?.match?.jobRequest?.customer?.phone
  const customerName: string = jobAny.booking?.match?.jobRequest?.customer?.name ?? ''
  const customerFirstName = customerName.split(' ')[0] || 'there'

  if (customerPhone) {
    await sendCustomerRunningLateNotification({
      customerPhone,
      customerFirstName,
      providerName: provider.name,
      delayLabel: 'a little late',
      jobCategory: category,
      jobId: activeJob.id,
    })
  }

  // Log JobStatusEvent
  await db.jobStatusEvent.create({
    data: {
      jobId: activeJob.id,
      fromStatus: (activeJob as any).status,
      toStatus: (activeJob as any).status,
      actorId: provider.id,
      actorRole: 'provider',
      notes: 'provider_running_late',
    },
  }).catch((err: Error) => {
    console.error('[provider-journey] running-late JobStatusEvent failed:', err)
  })

  // Log MessageEvent for the outbound notification to provider
  await logOutboundMessage({
    to: phone,
    templateName: 'customer_provider_running_late',
    body: 'Provider running-late notification sent to customer.',
  }).catch(() => {})

  await sendText(phone, "Your customer has been notified that you're running late.")
  return { nextStep: 'done' }
}

// ─── M5-T4: Provider dispute trigger ─────────────────────────────────────────

export async function handleProviderDisputeFlow(phone: string): Promise<FlowResult> {
  await sendText(phone, 'Briefly describe the issue (reply with at least 10 characters):')
  return { nextStep: 'pj_dispute_collect' }
}

async function handleProviderDisputeCollect(ctx: FlowContext): Promise<FlowResult> {
  const reason = ctx.reply.text?.trim() ?? ''

  if (reason.length < 10) {
    await sendText(ctx.phone, 'Description too short. Please reply with at least 10 characters describing the issue:')
    return { nextStep: 'pj_dispute_collect' }
  }

  const provider = await findProviderForWhatsApp(ctx.phone)
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  // Find most recent active or recently completed job
  const job = await db.job.findFirst({
    where: {
      providerId: provider.id,
      status: { in: [...ACTIVE_JOB_STATUSES, 'COMPLETED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  if (!job) {
    await sendText(ctx.phone, "No active or recent job found to raise a dispute against. Contact support if you need further help.")
    return { nextStep: 'done' }
  }

  const dispute = await db.dispute.create({
    data: {
      jobId: job.id,
      raisedById: provider.id,
      raisedByRole: 'provider',
      reason,
      status: 'OPEN',
    },
  })

  await recordAuditLog({
    actorId: provider.id,
    actorRole: 'provider',
    action: 'dispute.created',
    entityType: AUDIT_ENTITY.DISPUTE,
    entityId: dispute.id,
    after: toAuditJson({ jobId: job.id, raisedByRole: 'provider', status: 'OPEN', channel: 'whatsapp' }),
  }).catch((err: Error) => {
    console.error('[provider-journey] dispute audit log failed:', err)
  })

  const shortId = shortRef(dispute.id)
  await sendText(ctx.phone, `Dispute #${shortId} raised. Our team will review and contact you within 24 hours.`)
  return { nextStep: 'done' }
}

// ─── M5-T5: Post-job invoice keyword ─────────────────────────────────────────

export async function handleInvoiceFlow(phone: string): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(phone)
  if (!provider) {
    await sendText(phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const job = await db.job.findFirst({
    where: {
      providerId: provider.id,
      status: 'COMPLETED',
    },
    include: {
      booking: {
        include: {
          quote: { select: { amount: true, labourCost: true, materialsCost: true } },
          match: {
            include: {
              jobRequest: {
                include: {
                  customer: { select: { name: true, phone: true } },
                  address: { select: { suburb: true, city: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { completedAt: 'desc' },
  })

  if (!job) {
    await sendText(phone, "No completed jobs found. Contact support if you need help.")
    return { nextStep: 'done' }
  }

  const jobAny = job as any
  const category: string = jobAny.booking?.match?.jobRequest?.category ?? 'Service'
  const customerName: string = jobAny.booking?.match?.jobRequest?.customer?.name ?? 'Customer'
  const customerPhone: string | undefined = jobAny.booking?.match?.jobRequest?.customer?.phone
  const suburb: string = jobAny.booking?.match?.jobRequest?.address?.suburb ?? ''
  const city: string = jobAny.booking?.match?.jobRequest?.address?.city ?? ''
  const labourCost: number = Number(jobAny.booking?.quote?.labourCost ?? 0)
  const materialsCost: number = Number(jobAny.booking?.quote?.materialsCost ?? 0)
  const totalAmount: number = Number(jobAny.booking?.quote?.amount ?? 0)
  const bookingId: string = jobAny.booking?.id ?? job.id
  const jobRef = bookingId.slice(-8).toUpperCase()
  const completionDate = job.completedAt
    ? job.completedAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
    : job.createdAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

  if (customerPhone) {
    await sendProviderInvoiceTemplate({
      customerPhone,
      customerFullName: customerName,
      serviceLabel: category,
      suburb,
      city,
      completionDate,
      labourCost: `R ${labourCost.toFixed(2)}`,
      materialsCost: `R ${materialsCost.toFixed(2)}`,
      totalAmount: `R ${totalAmount.toFixed(2)}`,
      jobRef,
      providerFullName: provider.name,
      jobId: job.id,
    })
  }

  await sendText(phone, "Invoice sent to your customer.")
  return { nextStep: 'done' }
}

// ─── Top-Up (Pay@) ───────────────────────────────────────────────────────────

function getPayatFeeAmountCents(): number {
  const raw = process.env.PAYAT_MERCHANT_FEE_FIXED_CENTS
  if (!raw) return 700 // R7 default — update via env var once Pay@ confirms exact fee
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 700
}

const TOPUP_PACKAGES = [
  { id: 'provider_topup_100', amountCents: 10_000, credits: 2 },
  { id: 'provider_topup_200', amountCents: 20_000, credits: 4 },
  { id: 'provider_topup_500', amountCents: 50_000, credits: 10 },
] as const

async function handleTopUpSelectAmount(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone)
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  // Pre-check: require identity verification before showing top-up options.
  // Mirrors the server-side gate (assertIdentityVerifiedForCredits) so the provider
  // is redirected to verify BEFORE being shown amounts or using a stale amount button.
  const eligible = await isProviderEligibleForCredits(provider.id)
  if (!eligible) {
    const verificationLink = await issueIdentityVerificationLinkForWhatsApp(provider.id)
    const verificationUrl = verificationLink?.verificationUrl ?? getPublicAppUrl('/provider/verification')
    if (verificationUrl) {
      await sendCtaUrl(
        ctx.phone,
        '🛡️ *Identity check required*\n\nYou must complete identity verification before purchasing top-up credits.\n\nTap the button below to verify — it takes about 2 minutes and is required once.',
        ctaLabelFor('identity_verification'),
        verificationUrl,
      )
    } else {
      await sendText(
        ctx.phone,
        '🛡️ *Identity check required*\n\nYou must complete identity verification before purchasing top-up credits. Reply *verify identity* to get started.',
      )
    }
    return { nextStep: 'done' }
  }

  // Process a package selection reply
  const selected = TOPUP_PACKAGES.find((pkg) => pkg.id === ctx.reply.id)
  if (selected) {
    return handleTopUpPayatCreate(ctx, provider, selected.amountCents)
  }

  // First entry or unrecognised reply — show the package list
  const feeAmountCents = getPayatFeeAmountCents()
  const feeR = Math.round(feeAmountCents / 100)
  const creditLine = await providerCreditBalanceLine(provider.id)
  await sendList(
    ctx.phone,
    `💳 *Top Up Credits*\n\n${creditLine}\n\n1 credit = R50. Credits are used only when a customer selects you and you accept the job.\n\nPay at any Pick n Pay, Shoprite, or Checkers till — you'll receive a payment barcode to show at the cashier. A R${feeR} counter service fee is added to the amount you pay. Credits are added automatically once payment is confirmed.\n\nChoose how much to add:`,
    [{
      title: 'Pay at Retailer (Pay@)',
      rows: [
        { id: 'provider_topup_100', title: `R${Math.round((10_000 + feeAmountCents) / 100)} at till`, description: `2 credits (R${feeR} fee)` },
        { id: 'provider_topup_200', title: `R${Math.round((20_000 + feeAmountCents) / 100)} at till`, description: `4 credits (R${feeR} fee)` },
        { id: 'provider_topup_500', title: `R${Math.round((50_000 + feeAmountCents) / 100)} at till`, description: `10 credits (R${feeR} fee)` },
      ],
    }],
    { buttonLabel: 'Select Amount' },
  )
  return { nextStep: 'pj_topup_select_amount' }
}

async function handleTopUpPayatCreate(
  ctx: FlowContext,
  provider: { id: string; name: string | null; phone: string | null },
  amountCents: number,
): Promise<FlowResult> {
  const { sendCtaUrl } = await import('../whatsapp-interactive')
  const feeAmountCents = getPayatFeeAmountCents()

  try {
    const result = await createPayatTopUpIntent({
      providerId: provider.id,
      amountCents,
      feeAmountCents,
      providerCellphone: ctx.phone,
      metadata: { source: 'whatsapp' },
    })

    const credits = amountCents / 5000 // PROVIDER_CREDIT_PRICE_CENTS = 5000
    const totalR = Math.round(result.payAtAmountCents / 100)
    const creditsR = Math.round(amountCents / 100)
    const feeR = Math.round(feeAmountCents / 100)
    if (result.payat.paymentLink) {
      await sendCtaUrl(
        ctx.phone,
        `✅ *Pay@ Top-Up Ready*\n\nTap *Pay now* to get your payment barcode.\n\n*Total to pay at the till: R${totalR}*\n  • Credits: R${creditsR} (${credits} credit${credits !== 1 ? 's' : ''})\n  • Counter service fee: R${feeR}\n\nShow the barcode at any Pick n Pay, Shoprite, or Checkers till. Credits are added automatically once payment is confirmed — usually within a few minutes.`,
        'Pay now at retailer',
        result.payat.paymentLink,
      ).catch((err: unknown) => {
        console.error('[provider-journey] Pay@ CTA URL send failed (non-fatal)', {
          intentId: result.intent.id,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  } catch (err) {
    const isIdentityNotVerified =
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'IDENTITY_NOT_VERIFIED'

    const isDuplicate =
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'DUPLICATE_INTENT'

    if (isIdentityNotVerified) {
      const verificationLink = await issueIdentityVerificationLinkForWhatsApp(provider.id)
      const verificationUrl = verificationLink?.verificationUrl ?? getPublicAppUrl('/provider/verification')
      if (verificationUrl) {
        await sendCtaUrl(
          ctx.phone,
          '🛡️ *Identity check required*\n\nYou must complete identity verification before purchasing top-up credits.',
          ctaLabelFor('identity_verification'),
          verificationUrl,
        )
      } else {
        await sendText(
          ctx.phone,
          '🛡️ Identity check required. Reply *verify identity* from the provider menu to continue.',
        )
      }
      return { nextStep: 'pj_topup_select_amount' }
    }

    const message = isDuplicate
      ? `You already have an active Pay@ top-up link. Check your earlier messages for the payment barcode, or visit the provider portal to start a new one after it expires.`
      : `⚠️ Could not create your top-up. Please try again or visit the provider portal.`

    console.error('[provider-journey] createPayatTopUpIntent failed', {
      phone: ctx.phone,
      providerId: provider.id,
      amountCents,
      error: err instanceof Error ? err.message : String(err),
    })
    await sendText(ctx.phone, message)
    return { nextStep: 'pj_topup_select_amount' }
  }

  return { nextStep: 'pj_topup_payat_created' }
}

// ─── Voucher Redemption ───────────────────────────────────────────────────────

async function handleVoucherRedeemPrompt(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone)
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  if (isProviderInactive(provider) || !provider.active || provider.status !== 'ACTIVE') {
    await sendButtons(
      ctx.phone,
      'Your profile must be approved before you can redeem a voucher.',
      [
        { id: 'provider_status', title: 'Provider Status' },
        { id: 'back_home', title: 'Main Menu' },
      ],
    )
    return { nextStep: 'done' }
  }

  await sendText(ctx.phone, 'Please send your voucher code.\n\n_Example: PAP-7KQ9-M2XD_')
  return { nextStep: 'pj_redeem_voucher_awaiting_code' }
}

async function handleVoucherCodeEntry(ctx: FlowContext): Promise<FlowResult> {
  const provider = await findProviderForWhatsApp(ctx.phone)
  if (!provider) {
    await sendText(ctx.phone, "You're not registered as a provider. Reply *join* to apply.")
    return { nextStep: 'done' }
  }

  const rawCode = ctx.reply.text?.trim() ?? ''
  if (!rawCode) {
    await sendText(ctx.phone, 'Please send your voucher code.\n\n_Example: PAP-7KQ9-M2XD_')
    return { nextStep: 'pj_redeem_voucher_awaiting_code' }
  }

  try {
    const result = await redeemVoucher(provider.id, rawCode)

    if (result.ok) {
      const n = result.creditsAwarded
      await sendText(
        ctx.phone,
        `✅ Voucher redeemed successfully. ${n} credit${n === 1 ? ' has' : 's have'} been added to your account.\n\nReply *credits* to view your balance.`,
      )
    } else {
      await sendText(ctx.phone, mapVoucherRedemptionErrorToMessage(result.code))
    }
  } catch (err) {
    console.error('[voucher] WhatsApp redemption error', {
      providerId: provider.id,
      error: err instanceof Error ? err.message : String(err),
    })
    await sendText(ctx.phone, 'Something went wrong redeeming your voucher. Please try again or reply *menu* for options.')
  }

  return { nextStep: 'pj_credits' }
}
