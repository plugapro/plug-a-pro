// ─── Provider lead-response comms ─────────────────────────────────────────────
// Automated provider communications for lead-response behaviour:
//   - a WARNING to providers who have received leads but never responded, and
//   - a DEACTIVATION notice to providers being paused for no-show, inviting
//     them to reply with a motivation to be reactivated.
//
// Both go out via approved WhatsApp UTILITY templates (so they deliver outside
// the 24-hour session window, unlike free-form text), are idempotent, and are
// logged to MessageEvent. Sending is gated by `provider.comms.lead_response`
// so the ops sweep can dry-run a preview while the flag is OFF.
//
// The cohort decision (classifyLeadResponseCohort) is a pure function so the
// policy is unit-testable without a DB or Meta.

import type { MessageStatus, Prisma } from '@prisma/client'
import { db } from './db'
import { sendTemplate } from './whatsapp'
import { isEnabled } from './flags'
import { isInternalTestPhone } from './internal-test-cohort'

export const PROVIDER_LEAD_RESPONSE_COMMS_FLAG = 'provider.comms.lead_response'

// A provider is deactivated for no-show once they have received this many leads
// without ever responding (neither accepted nor declined — a decline counts as
// engagement, see below). Below the threshold they get a warning first.
export const NO_SHOW_DEACTIVATION_THRESHOLD = 3

const SENT_OR_BETTER: MessageStatus[] = ['SENT', 'DELIVERED', 'READ']

export type LeadResponseCohort = 'deactivate' | 'warn' | 'skip'

export interface LeadResponseStats {
  leadsReceived: number
  leadsAccepted: number
  // A decline is a deliberate response — an engaged provider, not a no-show.
  // Penalising declines would push providers to ignore leads (worse) or accept
  // work they cannot do, so decliners are never warned or deactivated here.
  leadsDeclined: number
  isInternalTestPhone: boolean
}

/**
 * Decide what comms (if any) a provider warrants based on their lead-response
 * history. Pure — no DB, no side effects.
 *
 * - Internal test accounts are always skipped.
 * - Any acceptance or any decline = engaged → skip (they are responding).
 * - >= NO_SHOW_DEACTIVATION_THRESHOLD leads, zero responses → deactivate.
 * - 1..threshold-1 leads, zero responses → warn.
 * - Zero leads → skip (nothing to respond to yet).
 */
export function classifyLeadResponseCohort(stats: LeadResponseStats): LeadResponseCohort {
  if (stats.isInternalTestPhone) return 'skip'
  if (stats.leadsAccepted > 0) return 'skip'
  if (stats.leadsDeclined > 0) return 'skip'
  if (stats.leadsReceived >= NO_SHOW_DEACTIVATION_THRESHOLD) return 'deactivate'
  if (stats.leadsReceived >= 1) return 'warn'
  return 'skip'
}

type CommKind = 'warning' | 'deactivation'

const COMM_CONFIG: Record<CommKind, {
  templateName: 'provider_lead_response_warning' | 'provider_deactivated_no_show'
  eventTemplateName: string
  buildBody: (name: string) => string
}> = {
  warning: {
    templateName: 'provider_lead_response_warning',
    eventTemplateName: 'provider:lead_response_warning',
    buildBody: (name) =>
      `Hi ${name}, this is Plug A Pro. You've been sent customer job leads but ` +
      `haven't responded. Please respond when you receive a lead - customers ` +
      `are waiting. If future leads go unanswered, your profile may be paused. ` +
      `Reply here if you need help using the app. Thanks.`,
  },
  deactivation: {
    templateName: 'provider_deactivated_no_show',
    eventTemplateName: 'provider:deactivated_no_show',
    buildBody: (name) =>
      `Hi ${name}, this is Plug A Pro. You received customer job leads recently ` +
      `but didn't respond to them, so we've paused your profile to keep ` +
      `customers matched with active providers. We'd like to have you back - ` +
      `just reply to this message telling us you're ready to take jobs and why ` +
      `you'd like to be reactivated, and our team will restore your profile. Thanks.`,
  },
}

export type ProviderCommResult =
  | { sent: true; externalId: string }
  | { sent: false; reason: 'flag_disabled' | 'no_phone' | 'duplicate' | 'failed' }

/**
 * Send a lead-response comm to a provider. Idempotent per (kind, provider):
 * a provider is warned / notified at most once by this key. Gated by
 * PROVIDER_LEAD_RESPONSE_COMMS_FLAG — returns {sent:false, reason:'flag_disabled'}
 * when off so callers can preview without sending.
 */
async function sendProviderComm(providerId: string, kind: CommKind): Promise<ProviderCommResult> {
  if (!(await isEnabled(PROVIDER_LEAD_RESPONSE_COMMS_FLAG).catch(() => false))) {
    return { sent: false, reason: 'flag_disabled' }
  }

  const provider = await db.provider.findUnique({
    where: { id: providerId },
    select: { id: true, name: true, phone: true },
  })
  if (!provider?.phone) return { sent: false, reason: 'no_phone' }

  const config = COMM_CONFIG[kind]
  const idempotencyKey = `${config.eventTemplateName}:${provider.id}`

  const existing = await db.messageEvent.findFirst({
    where: { idempotencyKey, status: { in: SENT_OR_BETTER } },
    select: { id: true },
  })
  if (existing) return { sent: false, reason: 'duplicate' }

  const name = (provider.name ?? '').trim() || 'there'
  const body = config.buildBody(name)

  try {
    const externalId = await sendTemplate({
      to: provider.phone,
      template: config.templateName,
      components: [{ type: 'body', parameters: [{ type: 'text', text: name }] }],
    })

    await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        providerId: provider.id,
        templateName: config.eventTemplateName,
        body,
        to: provider.phone,
        externalId,
        idempotencyKey,
        status: 'SENT',
        sentAt: new Date(),
        metadata: { providerId: provider.id, kind } as Prisma.InputJsonValue,
      },
    })

    return { sent: true, externalId }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error)
    console.error('[provider-lead-response-comms] WhatsApp send failed', {
      providerId: provider.id,
      kind,
      error: failureReason,
    })
    await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        providerId: provider.id,
        templateName: config.eventTemplateName,
        body,
        to: provider.phone,
        idempotencyKey,
        status: 'FAILED',
        failureReason,
        metadata: { providerId: provider.id, kind } as Prisma.InputJsonValue,
      },
    }).catch(() => {})
    return { sent: false, reason: 'failed' }
  }
}

export function sendLeadResponseWarning(providerId: string): Promise<ProviderCommResult> {
  return sendProviderComm(providerId, 'warning')
}

export function sendDeactivationNotice(providerId: string): Promise<ProviderCommResult> {
  return sendProviderComm(providerId, 'deactivation')
}
