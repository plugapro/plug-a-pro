import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

const SIX_HOURS_MS = 6 * 60 * 60 * 1000
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
const MONITOR_SLOT_HOURS = [0, 6, 12, 18]
const MONITOR_SLOT_MINUTE = 13
const CAMPAIGN_BASELINE_UTC = new Date('2026-05-28T07:31:00.000Z')

const EXCLUDED_PHONES = [
  '+27773923802',
  '+27764010810',
  '+27823035070',
  '+27832114183',
  '+27824978565',
  '+27827006695',
  '+27738131154',
  '+27711000001',
  '+27799000001',
  '+27800111222',
  '+27821234567',
  '+27823035040',
  '+27831000001',
  '+447710173736',
]

const EXCLUDED_NORMALIZED = new Set(EXCLUDED_PHONES)

export type FlyerStage =
  | 'conversation'
  | 'wa_inbound'
  | 'otp_sent'
  | 'auth_user'
  | 'job_request'
  | 'customer'
  | 'provider_app'
  | 'provider'

const STAGE_PRIORITY = {
  conversation: 1,
  wa_inbound: 2,
  otp_sent: 3,
  auth_user: 4,
  job_request: 5,
  customer: 6,
  provider_app: 7,
  provider: 8,
} as const satisfies Record<FlyerStage, number>

export type FlyerMonitorRow = {
  stage: FlyerStage
  phone: string | null
  at: string
  detail: string | null
  failureCode: string | null
}

export type FlyerSecurityEventRow = {
  severity: string
  eventType: string
  phone: string | null
  at: string
  status: string | null
}

export type FlyerLifetimeCounts = {
  customers: number
  providers: number
  providerApplications: number
}

export type FlyerFrictionCode =
  | 'OTP_DELIVERY_FAILED'
  | 'OTP_ENTRY_STUCK'
  | 'IDENTITY_LINK_STUCK'
  | 'PROVIDER_APP_PENDING'
  | 'PROVIDER_APP_MORE_INFO_REQUIRED'
  | 'WHATSAPP_WELCOME_IDLE'

export type FlyerFriction = {
  code: FlyerFrictionCode
  message: string
  suggestedAction: string
  humanActionRecommended: boolean
}

export type FlyerTimelineEntry = {
  stage: FlyerStage
  atIso: string
  atSast: string
  ageMinutes: number
  detail: string | null
  failureCode: string | null
}

export type FlyerProspect = {
  phoneMasked: string
  phoneHash: string
  furthestStage: FlyerStage
  furthestStageAgeMinutes: number
  furthestStageDetail: string | null
  timeline: FlyerTimelineEntry[]
  friction: FlyerFriction[]
}

export type FlyerMonitorReport = {
  subject: string
  generatedAtIso: string
  generatedAtSast: string
  prospectCount: number
  alertLines: string[]
  prospects: FlyerProspect[]
  frictionSummary: {
    providerAppPending: number
    otpEntry: number
    identityLink: number
    moreInfoRequired: number
    whatsappWelcomeIdle: number
    otpDeliveryFailed: number
  }
  lifetimeCounts: FlyerLifetimeCounts
  securityEvents: Array<{
    severity: string
    eventType: string
    phoneMasked: string | null
    atIso: string
    atSast: string
    status: string | null
  }>
  window: {
    startIso: string
    endIso: string
    nextPollIso: string
    startSast: string
    endSast: string
    nextPollSast: string
    baselineApplied: boolean
    mode: 'stateless_scheduled_slot'
  }
}

type AnalyzeInput = {
  now: Date
  windowStart: Date
  windowEnd: Date
  rows: FlyerMonitorRow[]
  securityEvents: FlyerSecurityEventRow[]
  lifetimeCounts: FlyerLifetimeCounts
}

type WindowBounds = {
  windowStart: Date
  windowEnd: Date
  nextPoll: Date
  baselineApplied: boolean
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  if (!trimmed) return null

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (trimmed.startsWith('+')) return `+${digits}`
  if (digits.startsWith('27') || digits.startsWith('44')) return `+${digits}`
  if (digits.length === 10 && digits.startsWith('0')) return `+27${digits.slice(1)}`
  return `+${digits}`
}

export function maskPhone(phoneE164: string): string {
  const normalized = normalizePhone(phoneE164) ?? phoneE164
  if (normalized.length <= 7) return '[masked-phone]'
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`
}

export function buildFlyerWindow(now = new Date()): WindowBounds {
  const windowEnd = previousMonitorSlot(now)
  const rawStart = new Date(windowEnd.getTime() - SIX_HOURS_MS)
  const baselineApplied = rawStart < CAMPAIGN_BASELINE_UTC
  const windowStart = baselineApplied ? CAMPAIGN_BASELINE_UTC : rawStart
  const nextPoll = new Date(windowEnd.getTime() + SIX_HOURS_MS)
  return { windowStart, windowEnd, nextPoll, baselineApplied }
}

export function analyzeFlyerMonitorRows(input: AnalyzeInput): FlyerMonitorReport {
  const grouped = new Map<string, FlyerMonitorRow[]>()

  for (const row of input.rows) {
    const phone = normalizePhone(row.phone)
    if (!phone || EXCLUDED_NORMALIZED.has(phone)) continue
    const existing = grouped.get(phone) ?? []
    existing.push(row)
    grouped.set(phone, existing)
  }

  const prospects = Array.from(grouped.entries())
    .map(([phone, rows]) => buildProspect(phone, rows, input.now))
    .sort((a, b) => {
      const latestA = Math.max(...a.timeline.map((entry) => Date.parse(entry.atIso)))
      const latestB = Math.max(...b.timeline.map((entry) => Date.parse(entry.atIso)))
      return latestB - latestA
    })

  const securityEvents = input.securityEvents.map((event) => {
    const phone = normalizePhone(event.phone)
    return {
      severity: event.severity,
      eventType: event.eventType,
      phoneMasked: phone ? maskPhone(phone) : null,
      atIso: toIso(event.at),
      atSast: formatSastDateTime(new Date(event.at)),
      status: sanitizeDetail(event.status),
    }
  })

  const frictionSummary = {
    providerAppPending: countFriction(prospects, 'PROVIDER_APP_PENDING'),
    otpEntry: countFriction(prospects, 'OTP_ENTRY_STUCK'),
    identityLink: countFriction(prospects, 'IDENTITY_LINK_STUCK'),
    moreInfoRequired: countFriction(prospects, 'PROVIDER_APP_MORE_INFO_REQUIRED'),
    whatsappWelcomeIdle: countFriction(prospects, 'WHATSAPP_WELCOME_IDLE'),
    otpDeliveryFailed: countFriction(prospects, 'OTP_DELIVERY_FAILED'),
  }

  const alertLines = buildAlertLines(prospects, securityEvents)
  const nextPoll = new Date(input.windowEnd.getTime() + SIX_HOURS_MS)
  const window = {
    startIso: input.windowStart.toISOString(),
    endIso: input.windowEnd.toISOString(),
    nextPollIso: nextPoll.toISOString(),
    startSast: formatSastDateTime(input.windowStart),
    endSast: formatSastDateTime(input.windowEnd),
    nextPollSast: formatSastDateTime(nextPoll),
    baselineApplied: input.windowStart.getTime() === CAMPAIGN_BASELINE_UTC.getTime(),
    mode: 'stateless_scheduled_slot' as const,
  }

  return {
    subject: `PlugAPro flyer monitor — ${prospects.length} prospect(s) — ${window.endSast}`,
    generatedAtIso: input.now.toISOString(),
    generatedAtSast: formatSastDateTime(input.now),
    prospectCount: prospects.length,
    alertLines,
    prospects,
    frictionSummary,
    lifetimeCounts: input.lifetimeCounts,
    securityEvents,
    window,
  }
}

export function buildFlyerMonitorReport(report: FlyerMonitorReport): string {
  const heading = report.prospectCount === 0
    ? `## Plug A Pro flyer monitor — ${report.window.startSast} → ${report.window.endSast}`
    : `## Plug A Pro flyer monitor — ${report.window.startSast} → ${report.window.endSast} — ${report.prospectCount} prospect(s)`

  if (report.prospectCount === 0) {
    return [
      heading,
      '',
      '**0 prospects in this window.**',
      '',
      '_Lifetime non-test counts (sanity check):_',
      `- customers: ${report.lifetimeCounts.customers}`,
      `- providers: ${report.lifetimeCounts.providers}`,
      `- provider_applications: ${report.lifetimeCounts.providerApplications}`,
      '',
      `_Next poll: ${report.window.nextPollSast}_`,
    ].join('\n')
  }

  const lines = [
    heading,
    '',
    ...report.alertLines,
    ...(report.alertLines.length > 0 ? [''] : []),
    '### Prospects',
    '',
  ]

  for (const prospect of report.prospects) {
    const detail = prospect.furthestStageDetail ? ` at ${prospect.furthestStageDetail}` : ''
    lines.push(
      `- **${prospect.phoneMasked}** | furthest stage: \`${prospect.furthestStage}\` | ${prospect.furthestStageAgeMinutes} min${detail}`,
    )
    for (const entry of prospect.timeline) {
      const entryDetail = timelineDetail(entry)
      lines.push(`  - ${entry.atSast.slice(11, 16)} ${entry.stage}${entryDetail}`)
    }
    for (const friction of prospect.friction) {
      const prefix = friction.humanActionRecommended ? '  - ⚠️ HUMAN ACTION RECOMMENDED: ' : '  - ⚠️ '
      lines.push(`${prefix}${friction.message}`)
      lines.push(`  - Suggested action: ${friction.suggestedAction}`)
    }
  }

  lines.push(
    '',
    '### Friction summary',
    '',
    `- ${report.frictionSummary.providerAppPending} stuck at provider_app PENDING`,
    `- ${report.frictionSummary.otpEntry} stuck at OTP entry`,
    `- ${report.frictionSummary.identityLink} stuck at identity link`,
    `- ${report.frictionSummary.moreInfoRequired} need provider_app more-info review`,
    `- ${report.frictionSummary.whatsappWelcomeIdle} lost in WhatsApp welcome`,
    '',
    `_Next poll: ${report.window.nextPollSast}_`,
  )

  return lines.join('\n')
}

export async function getFlyerMonitorReport(options: { now?: Date } = {}): Promise<FlyerMonitorReport> {
  const now = options.now ?? new Date()
  const { windowStart, windowEnd } = buildFlyerWindow(now)
  const [rows, securityEvents, lifetimeCountsRows] = await Promise.all([
    queryFlyerRows(windowStart, windowEnd),
    querySecurityEvents(windowStart, windowEnd),
    queryLifetimeCounts(),
  ])

  return analyzeFlyerMonitorRows({
    now,
    windowStart,
    windowEnd,
    rows,
    securityEvents,
    lifetimeCounts: normalizeLifetimeCounts(lifetimeCountsRows[0]),
  })
}

function buildProspect(phone: string, rows: FlyerMonitorRow[], now: Date): FlyerProspect {
  const timeline = rows
    .map((row) => {
      const at = new Date(row.at)
      return {
        stage: row.stage,
        atIso: at.toISOString(),
        atSast: formatSastDateTime(at),
        ageMinutes: Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000)),
        detail: sanitizeDetail(row.detail),
        failureCode: sanitizeDetail(row.failureCode),
      }
    })
    .sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso))

  const firstEntry = timeline[0]
  if (!firstEntry) {
    throw new Error('Cannot build flyer prospect without timeline entries')
  }

  const furthest = timeline.reduce((best, entry) => {
    const entryPriority = STAGE_PRIORITY[entry.stage]
    const bestPriority = STAGE_PRIORITY[best.stage]
    if (entryPriority > bestPriority) return entry
    if (entryPriority === bestPriority && Date.parse(entry.atIso) > Date.parse(best.atIso)) return entry
    return best
  }, firstEntry)

  const friction = buildFriction(timeline)
  return {
    phoneMasked: maskPhone(phone),
    phoneHash: hashPhone(phone),
    furthestStage: furthest.stage,
    furthestStageAgeMinutes: furthest.ageMinutes,
    furthestStageDetail: summarizeFurthestDetail(furthest),
    timeline,
    friction,
  }
}

function buildFriction(timeline: FlyerTimelineEntry[]): FlyerFriction[] {
  const friction: FlyerFriction[] = []
  const hasAuthUser = timeline.some((entry) => entry.stage === 'auth_user')
  const hasCustomerOrProvider = timeline.some((entry) =>
    entry.stage === 'customer' || entry.stage === 'provider' || entry.stage === 'provider_app')
  const hasCustomer = timeline.some((entry) => entry.stage === 'customer')
  const hasProvider = timeline.some((entry) => entry.stage === 'provider')

  for (const entry of timeline) {
    if (entry.stage === 'otp_sent' && isFailed(entry.detail)) {
      friction.push({
        code: 'OTP_DELIVERY_FAILED',
        message: `OTP delivery failed${entry.failureCode ? ` with ${entry.failureCode}` : ''}.`,
        suggestedAction: 'Inspect Meta delivery status and the Supabase auth hook logs.',
        humanActionRecommended: isBlockingOtpFailure(entry.failureCode),
      })
    }

    if (entry.stage === 'otp_sent' && entry.ageMinutes > 10 && !hasAuthUser) {
      friction.push({
        code: 'OTP_ENTRY_STUCK',
        message: `OTP was sent ${entry.ageMinutes} min ago but no auth_user exists.`,
        suggestedAction: 'Check OTP delivery telemetry before any manual outreach.',
        humanActionRecommended: false,
      })
    }

    if (entry.stage === 'auth_user' && entry.ageMinutes > 30 && !hasCustomerOrProvider) {
      friction.push({
        code: 'IDENTITY_LINK_STUCK',
        message: `Auth user exists for ${entry.ageMinutes} min but no customer or provider record exists.`,
        suggestedAction: 'Inspect auth link/session logs and avoid manually creating records unless approved.',
        humanActionRecommended: false,
      })
    }

    if (entry.stage === 'provider_app' && providerStatus(entry.detail) === 'PENDING' && entry.ageMinutes > 30) {
      friction.push({
        code: 'PROVIDER_APP_PENDING',
        message: `Provider application has been PENDING for ${entry.ageMinutes} min.${notesSuffix(entry.detail)}`,
        suggestedAction: 'Review the admin queue; if safe, run provider-auto-approve or complete admin review.',
        humanActionRecommended: entry.ageMinutes > 120 && notesText(entry.detail).toUpperCase().includes('NO_FLAGS'),
      })
    }

    if (entry.stage === 'provider_app' && providerStatus(entry.detail) === 'MORE_INFO_REQUIRED') {
      const notes = notesText(entry.detail)
      friction.push({
        code: 'PROVIDER_APP_MORE_INFO_REQUIRED',
        message: `Provider application needs more info.${notes ? ` Notes: "${notes}"` : ''}`,
        suggestedAction: 'Review in the admin UI and request only the missing evidence.',
        humanActionRecommended: /photo|id|document|certificate|missing/i.test(notes),
      })
    }

    if (
      entry.stage === 'conversation' &&
      isIdleWelcome(entry.detail) &&
      entry.ageMinutes > 30 &&
      !hasCustomer &&
      !hasProvider
    ) {
      friction.push({
        code: 'WHATSAPP_WELCOME_IDLE',
        message: `Conversation stayed at idle/welcome for ${entry.ageMinutes} min.`,
        suggestedAction: 'Inspect WhatsApp bot state and inbound message processing.',
        humanActionRecommended: false,
      })
    }
  }

  return dedupeFriction(friction)
}

function buildAlertLines(
  prospects: FlyerProspect[],
  securityEvents: FlyerMonitorReport['securityEvents'],
): string[] {
  const alerts: string[] = []
  if (prospects.length > 5) {
    alerts.push(`ALERT: ${prospects.length} new prospects in this 6-hour window.`)
  }

  const blockingFailures = new Set<string>()
  for (const prospect of prospects) {
    for (const entry of prospect.timeline) {
      if (isBlockingOtpFailure(entry.failureCode)) {
        blockingFailures.add(entry.failureCode as string)
      }
    }
  }
  for (const failure of Array.from(blockingFailures).sort()) {
    alerts.push(`ALERT: OTP delivery failure ${failure} detected.`)
  }

  if (securityEvents.length > 0) {
    alerts.push(`ALERT: ${securityEvents.length} HIGH/CRITICAL security event(s) in this window.`)
  }

  return alerts
}

async function queryFlyerRows(windowStart: Date, windowEnd: Date): Promise<FlyerMonitorRow[]> {
  return db.$queryRaw<FlyerMonitorRow[]>(Prisma.sql`
    WITH bounds AS (
      SELECT ${windowStart}::timestamptz AS window_start, ${windowEnd}::timestamptz AS window_end
    )
    SELECT 'otp_sent' AS stage, "phoneE164" AS phone, "createdAt"::text AS at,
           status::text AS detail, "failureCode"::text AS "failureCode"
    FROM otp_delivery_attempts, bounds
    WHERE "createdAt" >= bounds.window_start AND "createdAt" < bounds.window_end
    UNION ALL
    SELECT 'auth_user' AS stage, phone AS phone, created_at::text AS at,
           NULL::text AS detail, NULL::text AS "failureCode"
    FROM auth.users, bounds
    WHERE created_at >= bounds.window_start AND created_at < bounds.window_end AND phone IS NOT NULL
    UNION ALL
    SELECT 'customer' AS stage, phone AS phone, "createdAt"::text AS at,
           NULL::text AS detail, NULL::text AS "failureCode"
    FROM customers, bounds
    WHERE "createdAt" >= bounds.window_start AND "createdAt" < bounds.window_end
      AND COALESCE("isTestUser", false) = false
    UNION ALL
    SELECT 'job_request' AS stage, c.phone AS phone, jr."createdAt"::text AS at,
           jr.status::text || COALESCE(' / ' || LEFT(jr.source, 80), '') AS detail,
           NULL::text AS "failureCode"
    FROM job_requests jr
    JOIN customers c ON c.id = jr."customerId", bounds
    WHERE jr."createdAt" >= bounds.window_start AND jr."createdAt" < bounds.window_end
      AND COALESCE(jr."isTestRequest", false) = false
      AND COALESCE(c."isTestUser", false) = false
    UNION ALL
    SELECT 'provider_app' AS stage, phone AS phone, "submittedAt"::text AS at,
           status::text || COALESCE(' / ' || LEFT(notes, 80), '') AS detail,
           NULL::text AS "failureCode"
    FROM provider_applications, bounds
    WHERE "submittedAt" >= bounds.window_start AND "submittedAt" < bounds.window_end
      AND COALESCE("isTestUser", false) = false
    UNION ALL
    SELECT 'provider' AS stage, phone AS phone, "createdAt"::text AS at,
           status::text AS detail, NULL::text AS "failureCode"
    FROM providers, bounds
    WHERE "createdAt" >= bounds.window_start AND "createdAt" < bounds.window_end
      AND COALESCE("isTestUser", false) = false
    UNION ALL
    SELECT 'wa_inbound' AS stage, phone AS phone, "firstSeenAt"::text AS at,
           "messageType"::text || ' / ' || LEFT(COALESCE(body, ''), 60) AS detail,
           NULL::text AS "failureCode"
    FROM inbound_whatsapp_messages, bounds
    WHERE "firstSeenAt" >= bounds.window_start AND "firstSeenAt" < bounds.window_end
    UNION ALL
    SELECT 'conversation' AS stage, phone AS phone, "updatedAt"::text AS at,
           flow::text || '/' || step::text AS detail, NULL::text AS "failureCode"
    FROM conversations, bounds
    WHERE "updatedAt" >= bounds.window_start AND "updatedAt" < bounds.window_end
      AND COALESCE("isTestSession", false) = false
    ORDER BY phone, at
  `)
}

async function querySecurityEvents(windowStart: Date, windowEnd: Date): Promise<FlyerSecurityEventRow[]> {
  return db.$queryRaw<FlyerSecurityEventRow[]>(Prisma.sql`
    WITH bounds AS (
      SELECT ${windowStart}::timestamptz AS window_start, ${windowEnd}::timestamptz AS window_end
    )
    SELECT severity::text AS severity, "eventType"::text AS "eventType",
           "phoneE164"::text AS phone, "createdAt"::text AS at, status::text AS status
    FROM security_events, bounds
    WHERE "createdAt" >= bounds.window_start AND "createdAt" < bounds.window_end
      AND severity IN ('HIGH', 'CRITICAL')
    ORDER BY "createdAt" ASC
  `)
}

async function queryLifetimeCounts(): Promise<Array<{
  customers: bigint | number
  providers: bigint | number
  providerApplications: bigint | number
}>> {
  const excludedPhones = Prisma.join(EXCLUDED_PHONES)

  return db.$queryRaw<Array<{
    customers: bigint | number
    providers: bigint | number
    providerApplications: bigint | number
  }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM customers
        WHERE "createdAt" >= ${CAMPAIGN_BASELINE_UTC}::timestamptz
          AND COALESCE("isTestUser", false) = false
          AND phone NOT IN (${excludedPhones})) AS customers,
      (SELECT COUNT(*) FROM providers
        WHERE "createdAt" >= ${CAMPAIGN_BASELINE_UTC}::timestamptz
          AND COALESCE("isTestUser", false) = false
          AND phone NOT IN (${excludedPhones})) AS providers,
      (SELECT COUNT(*) FROM provider_applications
        WHERE "submittedAt" >= ${CAMPAIGN_BASELINE_UTC}::timestamptz
          AND COALESCE("isTestUser", false) = false
          AND phone NOT IN (${excludedPhones})) AS "providerApplications"
  `)
}

function normalizeLifetimeCounts(row: {
  customers?: bigint | number
  providers?: bigint | number
  providerApplications?: bigint | number
} | undefined): FlyerLifetimeCounts {
  return {
    customers: Number(row?.customers ?? 0),
    providers: Number(row?.providers ?? 0),
    providerApplications: Number(row?.providerApplications ?? 0),
  }
}

function summarizeFurthestDetail(entry: FlyerTimelineEntry): string | null {
  if (!entry.detail && !entry.failureCode) return null
  if (entry.stage === 'otp_sent') {
    return entry.failureCode ? `${entry.detail ?? 'unknown'} / ${entry.failureCode}` : entry.detail
  }
  return entry.detail
}

function timelineDetail(entry: FlyerTimelineEntry): string {
  if (entry.stage === 'otp_sent') {
    if (entry.failureCode) return ` (${entry.detail ?? 'failed'} / ${entry.failureCode})`
    if (entry.detail) return ` (${entry.detail} ok)`
  }
  if (entry.detail) return ` (${entry.detail})`
  return ''
}

function countFriction(prospects: FlyerProspect[], code: FlyerFrictionCode): number {
  return prospects.reduce(
    (count, prospect) => count + (prospect.friction.some((friction) => friction.code === code) ? 1 : 0),
    0,
  )
}

function dedupeFriction(friction: FlyerFriction[]): FlyerFriction[] {
  const seen = new Set<FlyerFrictionCode>()
  return friction.filter((item) => {
    if (seen.has(item.code)) return false
    seen.add(item.code)
    return true
  })
}

function providerStatus(detail: string | null): string | null {
  if (!detail) return null
  return detail.split('/')[0]?.trim().toUpperCase() ?? null
}

function notesText(detail: string | null): string {
  if (!detail || !detail.includes('/')) return ''
  return sanitizeDetail(detail.split('/').slice(1).join('/')) ?? ''
}

function notesSuffix(detail: string | null): string {
  const notes = notesText(detail)
  return notes ? ` Notes: "${notes}"` : ''
}

function isFailed(detail: string | null): boolean {
  return detail?.toLowerCase() === 'failed'
}

function isBlockingOtpFailure(failureCode: string | null): boolean {
  return failureCode === 'TEMPLATE_NOT_APPROVED' || failureCode === 'WA_AUTH_FAILED'
}

function isIdleWelcome(detail: string | null): boolean {
  return detail?.toLowerCase() === 'idle/welcome'
}

function hashPhone(phone: string): string {
  const salt = process.env.FLYER_MONITOR_HASH_SALT ?? process.env.CRON_SECRET ?? 'flyer-monitor'
  return createHash('sha256').update(`${salt}:${phone}`).digest('hex').slice(0, 12)
}

function previousMonitorSlot(now: Date): Date {
  const sastNowMs = now.getTime() + SAST_OFFSET_MS
  const sastNow = new Date(sastNowMs)
  const localDayStartMs = Date.UTC(
    sastNow.getUTCFullYear(),
    sastNow.getUTCMonth(),
    sastNow.getUTCDate(),
  )

  const slotMs = MONITOR_SLOT_HOURS
    .map((hour) => localDayStartMs + hour * 60 * 60 * 1000 + MONITOR_SLOT_MINUTE * 60 * 1000)
    .filter((candidate) => candidate <= sastNowMs)
    .pop()
    ?? localDayStartMs - 6 * 60 * 60 * 1000 + MONITOR_SLOT_MINUTE * 60 * 1000

  return new Date(slotMs - SAST_OFFSET_MS)
}

function sanitizeDetail(value: string | null | undefined): string | null {
  if (!value) return null
  return value
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[redacted-phone]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function toIso(value: string): string {
  return new Date(value).toISOString()
}

function formatSastDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '00'

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} SAST`
}
