// ─── Cron: WhatsApp session inactivity timeout ────────────────────────────────
// Schedule: */10 5-20 * * * (every 10 min, 07:00–22:00 SAST)
//
// For every mid-flow conversation that has expired and not yet been notified:
//   1. Atomically claim it via timeoutNotifiedAt (prevents duplicate sends)
//   2. Send the customer a polite "session ended" WhatsApp message
//   3. Leave flow/data intact - the bot's existing resume logic fires on next reply
//
// Only processes sessions where expiresAt is within the past 23 hours to ensure
// we remain inside the WhatsApp 24-hour session window (sendText is valid).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendText } from '@/lib/whatsapp-interactive'
import { maskPhone } from '@/lib/support-diagnostics'
import {
  classifyProviderOnboardingRecovery,
  getRecoveryMessageTemplate,
  recordOnboardingRecoveryAudit,
  shouldSendAutomatedOnboardingNudge,
  type OnboardingRecoveryAuditEvent,
  type OnboardingRecoveryStage,
} from '@/lib/provider-onboarding-recovery'
import { phoneLookupVariants } from '@/lib/utils'

// Flows that indicate an active mid-session state worth notifying about
const NOTIFIABLE_FLOWS = ['job_request', 'registration', 'status', 'help', 'reschedule', 'cancel']
const PROVIDER_RECOVERY_FLOWS = new Set(['idle', 'registration', 'job_request', 'help'])

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const cronStart = Date.now()
  const cronName = 'session-timeout'
  console.log(JSON.stringify({ event: 'cron_start', cron: cronName, timestamp: new Date().toISOString() }))

  try {
  const reqId = crypto.randomUUID().slice(0, 8)
  const now = new Date()
  const LOCK_SENTINEL = new Date(0)

  // Lower bound: 23 hours ago - sessions older than this are outside the WhatsApp
  // 24h session window; sendText would fail, so skip them
  const windowFloor = new Date(now.getTime() - 23 * 60 * 60 * 1000)
  const idleWelcomeNudgeFloor = new Date(now.getTime() - 15 * 60 * 1000)

  const expired = await db.conversation.findMany({
    where: {
      OR: [
        {
          flow:             { in: NOTIFIABLE_FLOWS },
          expiresAt:        { lt: now, gt: windowFloor },
        },
        {
          flow:             'idle',
          step:             'welcome',
          updatedAt:        { lt: idleWelcomeNudgeFloor, gt: windowFloor },
        },
      ],
      timeoutNotifiedAt: null,
    },
    select: {
      id:            true,
      phone:         true,
      flow:          true,
      step:          true,
      data:          true,
      createdAt:     true,
      updatedAt:     true,
      expiresAt:     true,
      isTestSession: true,
      cohortName:    true,
    },
  })

  console.log(`[cron/session-timeout:${reqId}] found=${expired.length} candidates`)

  let sent    = 0
  let skipped = 0
  let errors  = 0

  for (const conv of expired) {
    try {
      // ── Atomic claim - only one cron instance wins per conversation ────────
      const claimed = await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: null },
        data:  { timeoutNotifiedAt: LOCK_SENTINEL },
      })

      if (claimed.count === 0) {
        // Another process already claimed this conversation
        skipped++
        console.info(`[cron/session-timeout:${reqId}] already-claimed phone=${maskPhone(conv.phone)} id=${conv.id}`)
        continue
      }

      const providerRecoveryHandled = await tryProviderOnboardingRecoveryNudge(conv, now)
      if (providerRecoveryHandled === 'sent') {
        sent++
        console.log(
          `[cron/session-timeout:${reqId}] provider-recovery-sent phone=${maskPhone(conv.phone)} flow=${conv.flow} step=${conv.step} id=${conv.id}`
        )
        continue
      }
      if (providerRecoveryHandled === 'skipped') {
        skipped++
        console.info(
          `[cron/session-timeout:${reqId}] provider-recovery-skipped phone=${maskPhone(conv.phone)} flow=${conv.flow} step=${conv.step} id=${conv.id}`
        )
        continue
      }

      // ── Resolve customer first name ────────────────────────────────────────
      const firstName = await resolveFirstName(conv.phone, conv.data)

      // ── Check service opt-in ───────────────────────────────────────────────
      const customer = await db.customer.findUnique({
        where:  { phone: conv.phone },
        select: { whatsappServiceOptIn: true },
      })

      if (customer && !customer.whatsappServiceOptIn) {
        console.info(`[cron/session-timeout:${reqId}] service-opted-out phone=${maskPhone(conv.phone)} - skipping send`)
        await db.conversation.updateMany({
          where: { id: conv.id, timeoutNotifiedAt: LOCK_SENTINEL },
          data:  { timeoutNotifiedAt: now },
        }).catch(() => {})
        skipped++
        continue
      }

      // ── Send timeout message ───────────────────────────────────────────────
      const message =
        `Hi ${firstName}, your session has ended because there was no activity for a while. ` +
        `Please reply to this message when you're ready to continue and we'll help you pick up from there.`

      await sendText(conv.phone, message)

      // ── Write real timestamp only after confirmed send ─────────────────────
      await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: LOCK_SENTINEL },
        data:  { timeoutNotifiedAt: now },
      }).catch(() => {})

      sent++
      console.log(
        `[cron/session-timeout:${reqId}] sent phone=${maskPhone(conv.phone)} flow=${conv.flow} id=${conv.id}`
      )
    } catch (err) {
      errors++
      console.error(
        `[cron/session-timeout:${reqId}] error phone=${maskPhone(conv.phone)} id=${conv.id}:`,
        err
      )
    }
  }

  console.log(`[cron/session-timeout:${reqId}]`, { found: expired.length, sent, skipped, errors })
  const duration = Date.now() - cronStart
  console.log(JSON.stringify({ event: 'cron_complete', cron: cronName, durationMs: duration, timestamp: new Date().toISOString() }))
  return NextResponse.json({ found: expired.length, sent, skipped, errors, durationMs: duration })
  } catch (err) {
    const duration = Date.now() - cronStart
    console.error(JSON.stringify({ event: 'cron_error', cron: cronName, durationMs: duration, error: String(err), timestamp: new Date().toISOString() }))
    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TimeoutConversation = {
  id: string
  phone: string
  flow: string
  step: string
  data: unknown
  createdAt?: Date
  updatedAt?: Date
  expiresAt?: Date
  isTestSession?: boolean
  cohortName?: string | null
}

type ProviderRecoveryNudgeResult = 'sent' | 'skipped' | 'not_provider_recovery'

function recoveryAuditEventFrom(row: {
  action: string
  after: unknown
  timestamp: Date
}): OnboardingRecoveryAuditEvent | null {
  const after = row.after && typeof row.after === 'object' && !Array.isArray(row.after)
    ? row.after as Record<string, unknown>
    : {}
  const stage = typeof after.stage === 'string' ? after.stage as OnboardingRecoveryStage : null
  if (!stage) return null

  return {
    actionType: (typeof after.actionType === 'string'
      ? after.actionType
      : row.action.replace('provider_onboarding_recovery.', '')) as OnboardingRecoveryAuditEvent['actionType'],
    stage,
    result: typeof after.result === 'string' ? after.result : 'unknown',
    createdAt: row.timestamp,
  }
}

async function tryProviderOnboardingRecoveryNudge(
  conv: TimeoutConversation,
  now: Date,
): Promise<ProviderRecoveryNudgeResult> {
  if (!PROVIDER_RECOVERY_FLOWS.has(conv.flow)) return 'not_provider_recovery'

  const lookupPhones = phoneLookupVariants(conv.phone)
  const recentAuditFloor = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const [application, provider, auditRows] = await Promise.all([
    (db as any).providerApplication?.findFirst?.({
      where: { phone: { in: lookupPhones }, status: { in: ['PENDING', 'MORE_INFO_REQUIRED', 'APPROVED'] } },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        phone: true,
        status: true,
        providerId: true,
        skills: true,
        serviceAreas: true,
        submittedAt: true,
        updatedAt: true,
      },
    }) ?? null,
    (db as any).provider?.findFirst?.({
      where: { phone: { in: lookupPhones } },
      select: {
        id: true,
        phone: true,
        status: true,
        active: true,
        verified: true,
        skills: true,
        serviceAreas: true,
        updatedAt: true,
      },
    }) ?? null,
    (db as any).auditLog?.findMany?.({
      where: {
        entityType: 'Conversation',
        entityId: conv.id,
        action: 'provider_onboarding_recovery.automated_nudge_sent',
        timestamp: { gte: recentAuditFloor },
      },
      select: { action: true, after: true, timestamp: true },
    }) ?? [],
  ])

  const classification = classifyProviderOnboardingRecovery({
    conversation: {
      id: conv.id,
      phone: conv.phone,
      flow: conv.flow,
      step: conv.step,
      data: conv.data && typeof conv.data === 'object' && !Array.isArray(conv.data)
        ? conv.data as Record<string, unknown>
        : {},
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      expiresAt: conv.expiresAt,
    },
    application,
    provider,
  })

  const template = getRecoveryMessageTemplate(classification.stage)
  if (!template) {
    return classification.stage === 'submitted_pending' || classification.stage === 'submitted_approved' || classification.stage === 'completed'
      ? 'skipped'
      : 'not_provider_recovery'
  }

  const recentAuditEvents = (auditRows as Array<{ action: string; after: unknown; timestamp: Date }>)
    .map(recoveryAuditEventFrom)
    .filter((event): event is OnboardingRecoveryAuditEvent => Boolean(event))
  const decision = shouldSendAutomatedOnboardingNudge({
    stage: classification.stage,
    lastStateUpdateAt: conv.updatedAt ?? conv.createdAt ?? new Date(0),
    now,
    recentAuditEvents,
  })

  if (!decision.eligible) {
    await recordOnboardingRecoveryAudit(db, {
      actionType: 'automated_nudge_skipped',
      stage: classification.stage,
      result: decision.reason,
      phone: conv.phone,
      entityId: conv.id,
      messageTemplateKey: classification.templateKey,
      isTestEvent: Boolean(conv.isTestSession),
      cohortName: conv.cohortName ?? null,
    })
    await db.conversation.updateMany({
      where: { id: conv.id, timeoutNotifiedAt: new Date(0) },
      data: { timeoutNotifiedAt: now },
    }).catch(() => {})
    return classification.stage === 'unknown' ? 'not_provider_recovery' : 'skipped'
  }

  await sendText(conv.phone, template)
  await recordOnboardingRecoveryAudit(db, {
    actionType: 'automated_nudge_sent',
    stage: classification.stage,
    result: 'sent',
    phone: conv.phone,
    entityId: conv.id,
    messageTemplateKey: classification.templateKey,
    isTestEvent: Boolean(conv.isTestSession),
    cohortName: conv.cohortName ?? null,
  })

  const existingData = conv.data && typeof conv.data === 'object' && !Array.isArray(conv.data)
    ? conv.data as Record<string, unknown>
    : {}
  await db.conversation.updateMany({
    where: { id: conv.id, timeoutNotifiedAt: new Date(0) },
    data: {
      timeoutNotifiedAt: now,
      data: {
        ...existingData,
        lastAutomatedRecoveryNudgeStage: classification.stage,
        lastAutomatedRecoveryNudgeAt: now.toISOString(),
      },
    },
  }).catch(() => {})

  return 'sent'
}

async function resolveFirstName(phone: string, data: unknown): Promise<string> {
  // 1. Accumulated session data (fastest - already in memory)
  const sessionData = data as Record<string, unknown> | null
  const sessionName =
    (sessionData?.customerName as string | undefined) ??
    (sessionData?.name as string | undefined)

  if (sessionName) return sessionName.split(' ')[0]

  // 2. Customer record
  const customer = await db.customer.findUnique({
    where:  { phone },
    select: { name: true },
  })

  if (customer?.name) return customer.name.split(' ')[0]

  // 3. Fallback
  return 'there'
}
