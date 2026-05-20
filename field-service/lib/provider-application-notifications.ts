// ── G1 AUTH GAP — WhatsApp-only providers ─────────────────────────────────────
// Providers who register and are approved entirely via WhatsApp do not have a
// Supabase Auth account at the point this approval notification is sent.
// The Worker Portal URL included in the CTA is therefore inaccessible to them
// until an auth account is provisioned.
//
// Planned mitigation (tracked, not yet implemented):
//   On application approval, send a Supabase OTP invite to the provider's phone
//   number so they can authenticate with the portal.  The invite should be
//   issued in the same `crudAction` transaction that flips the application status
//   to APPROVED, immediately before this notification is dispatched.
//
// Until the OTP invite is shipped the Worker Portal link in the approval message
// is decorative.  Providers can still use WhatsApp commands (reply "menu") to
// check their status and accept leads.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from './db'
import {
  creditCountLabel,
  getProviderTermsUrl,
  getWorkerPortalUrl,
  PROVIDER_CREDITS_PRICE_LINE,
  PROVIDER_ACCEPTED_LEAD_CREDIT_COST,
} from './provider-credit-copy'

const APPROVAL_NOTIFICATION_LOCK_STALE_MINUTES = 10

type ProviderApprovalCreditSummary = {
  starterPromoCreditsAwarded: number
  paidCredits: number
  promoCredits: number
}

export type ProviderApplicationApprovalNotificationResult =
  | { status: 'sent'; externalId: string }
  | { status: 'skipped'; reason: 'already_sent' | 'send_in_progress' | 'not_found' }

export function buildProviderApplicationApprovedMessage(
  name: string,
  // _credits kept for call-site compatibility but no longer used in message body
  _credits?: ProviderApprovalCreditSummary,
): { mainBody: string; termsBody: string } {
  return {
    mainBody: `✅ *Application approved!*

Hi *${name}*, you're now active on Plug A Pro and can receive job leads through this WhatsApp number.

To activate your pilot credit, redeem your voucher code.
Reply *REDEEM* to enter your voucher code.

Credits are prepaid platform units, not cash, loans, or financial credit.
${PROVIDER_CREDITS_PRICE_LINE}
No credits are used for previewing or saying you are interested.
1 credit is used only when a customer selects you and you accept that selected job.
Full customer details unlock after acceptance.

You can continue here on WhatsApp. You can also open the Worker Portal for credits, working hours, and jobs:`,
    termsBody: `Provider credits terms and rules:\n\nDefault availability: *Available now*\n\nReply *menu* to check your status anytime.`,
  }
}

/**
 * Builds the WhatsApp message body for a MORE_INFO_REQUIRED application status.
 *
 * Body intentionally contains no raw URL. Caller should follow up with a
 * sendCtaUrl to expose the Worker Portal application page behind an
 * "Update Application" CTA.
 */
export function buildProviderApplicationMoreInfoRequiredMessage(params: {
  name?: string | null
  applicationRef: string
  notes?: string | null
}): string {
  const firstName = params.name?.trim().split(/\s+/)[0] || 'there'
  const notesLine = params.notes?.trim()
    ? `\n\n*What we need:*\n${params.notes.trim()}`
    : ''

  return [
    '📋 *More information needed*',
    '',
    `Hi *${firstName}*, your Plug A Pro provider application needs a few more details before we can complete the review.`,
    '',
    `Ref: *${params.applicationRef}*`,
    `Status: *More details needed*`,
    notesLine.trim(),
    '',
    'Please reply with the requested information or open the Worker Portal to update your application.',
    '',
    'No credits are used for previewing or saying you are interested.',
    `${PROVIDER_CREDITS_PRICE_LINE} ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)} is used only when a customer selects you and you accept that selected job.`,
    '',
    'You can continue here on WhatsApp. You can also open the Worker Portal for more details.',
  ].filter((line) => line !== undefined).join('\n')
}

/**
 * Builds the WhatsApp message body for a REJECTED application status.
 *
 * Body intentionally contains no raw URL. Caller should follow up with a
 * sendCtaUrl to expose support behind a "Contact Support" CTA.
 */
export function buildProviderApplicationRejectedMessage(params: {
  name?: string | null
  applicationRef: string
  reason?: string | null
}): string {
  const firstName = params.name?.trim().split(/\s+/)[0] || 'there'
  const reasonLine = params.reason?.trim()
    ? `\n\n*Reason:*\n${params.reason.trim()}`
    : ''

  return [
    '❌ *Application not approved*',
    '',
    `Hi *${firstName}*, your Plug A Pro provider application was not approved.`,
    '',
    `Ref: *${params.applicationRef}*`,
    `Status: *Not approved*`,
    reasonLine.trim(),
    '',
    'If you believe this decision is incorrect, or if you would like to understand the reason, please contact support.',
    '',
    'You can continue here on WhatsApp. You can also open the Worker Portal to contact support.',
  ].filter((line) => line !== undefined).join('\n')
}

/**
 * Builds the WhatsApp message body confirming that a provider has registered
 * their interest in a job opportunity. No credits are charged at this stage.
 *
 * Body intentionally contains no raw URL. Caller should follow up with a
 * sendCtaUrl to expose the lead detail page behind a "View Lead" CTA if
 * a signed lead URL is available.
 */
export function buildInterestSubmittedMessage(params: {
  category: string
  area: string
  callOutFee?: number | null
  estimatedArrivalLabel?: string | null
}): string {
  const feeLines = params.callOutFee != null
    ? [`Call-out fee submitted: *R${params.callOutFee}*`]
    : []
  const arrivalLines = params.estimatedArrivalLabel
    ? [`Estimated arrival: *${params.estimatedArrivalLabel}*`]
    : []

  return [
    '👍 *Interest registered*',
    '',
    `Your interest in the *${params.category}* job in *${params.area}* has been submitted.`,
    '',
    ...feeLines,
    ...arrivalLines,
    '',
    'No credits are used for previewing or saying you are interested.',
    `${PROVIDER_CREDITS_PRICE_LINE} ${creditCountLabel(PROVIDER_ACCEPTED_LEAD_CREDIT_COST)} is used only if the customer selects you and you accept that selected job.`,
    '',
    'You will be notified here if the customer selects you.',
    '',
    'You can continue here on WhatsApp. You can also open the Worker Portal for more details.',
  ].filter((line) => line !== undefined).join('\n')
}

/**
 * Builds the WhatsApp message body when a previously-available job lead is
 * no longer available (expired, taken, or closed). No credits were charged.
 *
 * Body intentionally contains no raw URL.
 */
export function buildJobUnavailableMessage(params: {
  category?: string | null
  area?: string | null
  reason?: 'expired' | 'taken' | 'closed' | 'unknown'
}): string {
  const jobLine = params.category
    ? `The *${params.category}*${params.area ? ` job in *${params.area}*` : ''} is`
    : 'This job is'

  const reasonMap: Record<string, string> = {
    expired: 'has expired and can no longer be accepted',
    taken: 'has been accepted by another provider',
    closed: 'has been closed by the customer',
    unknown: 'is no longer available',
  }
  const reasonPhrase = reasonMap[params.reason ?? 'unknown'] ?? reasonMap.unknown

  return [
    '⏰ *Job no longer available*',
    '',
    `${jobLine} ${reasonPhrase}.`,
    '',
    'No credits were used.',
    '',
    'New leads will be sent here as jobs arise in your service areas.',
    '',
    'You can continue here on WhatsApp. You can also open the Worker Portal to review your availability.',
  ].join('\n')
}


export async function notifyProviderApplicationApprovedOnce(params: {
  applicationId: string
  phone: string
  name: string
}): Promise<ProviderApplicationApprovalNotificationResult> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - APPROVAL_NOTIFICATION_LOCK_STALE_MINUTES * 60 * 1000)

  const lock = await db.providerApplication.updateMany({
    where: {
      id: params.applicationId,
      approvalWhatsappSentAt: null,
      OR: [
        { approvalWhatsappSendStartedAt: null },
        { approvalWhatsappSendStartedAt: { lt: staleBefore } },
      ],
    },
    data: { approvalWhatsappSendStartedAt: now },
  })

  if (lock.count === 0) {
    const existing = await db.providerApplication.findUnique({
      where: { id: params.applicationId },
      select: {
        approvalWhatsappSentAt: true,
        approvalWhatsappSendStartedAt: true,
      },
    })
    const reason = existing?.approvalWhatsappSentAt
      ? 'already_sent'
      : existing
        ? 'send_in_progress'
        : 'not_found'
    console.info('[provider-application-notifications] skipped approval WhatsApp', {
      applicationId: params.applicationId,
      reason,
    })
    return { status: 'skipped', reason }
  }

  try {
    const { sendCtaUrl } = await import('./whatsapp-interactive')
    const message = buildProviderApplicationApprovedMessage(params.name)
    const { mainBody, termsBody } = message

    const externalId = await sendCtaUrl(
      params.phone,
      mainBody,
      'Access Worker Portal',
      getWorkerPortalUrl('/provider'),
      undefined,
      {
        templateName: 'provider_application_approved',
        metadata: { providerApplicationId: params.applicationId },
      },
    )

    await sendCtaUrl(
      params.phone,
      termsBody,
      'View Credits Rules',
      getProviderTermsUrl(),
    )

    await db.providerApplication.update({
      where: { id: params.applicationId },
      data: {
        approvalWhatsappSendStartedAt: null,
        approvalWhatsappSentAt: new Date(),
        approvalWhatsappExternalId: externalId,
      },
    })

    return { status: 'sent', externalId }
  } catch (error) {
    await db.providerApplication.updateMany({
      where: {
        id: params.applicationId,
        approvalWhatsappSentAt: null,
      },
      data: { approvalWhatsappSendStartedAt: null },
    }).catch((unlockError: unknown) => {
      console.error('[provider-application-notifications] failed to release approval WhatsApp lock', {
        applicationId: params.applicationId,
        error: unlockError,
      })
    })
    throw error
  }
}
