import { db } from './db'
import {
  creditCountLabel,
  getProviderTermsUrl,
  getWorkerPortalUrl,
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
  credits: ProviderApprovalCreditSummary = {
    starterPromoCreditsAwarded: 0,
    paidCredits: 0,
    promoCredits: 0,
  },
): { mainBody: string; termsBody: string } {
  const totalCredits = credits.paidCredits + credits.promoCredits
  const creditLine = credits.starterPromoCreditsAwarded > 0
    ? `🎁 Starter credits awarded: *${creditCountLabel(credits.starterPromoCreditsAwarded)}*\n💳 Available balance: *${creditCountLabel(totalCredits)}*`
    : `💳 Available balance: *${creditCountLabel(totalCredits)}*. You'll need credits to accept matched job leads.`

  const breakdownLine = totalCredits > 0
    ? `\nStarter/onboarding: *${credits.promoCredits}* · Purchased: *${credits.paidCredits}*`
    : ''

  return {
    mainBody: `✅ *Application approved!*\n\nHi *${name}*, you're now active on Plug A Pro and can receive job leads through this WhatsApp number.\n\n${creditLine}${breakdownLine}\n\nEach lead you accept uses 1 credit. Full customer details unlock after acceptance.\n\nYou can view your credits, working hours, and jobs in the Worker Portal:`,
    termsBody: `Provider terms and credit rules:\n\nDefault availability: *Available now*\n\nReply *menu* to check your status anytime.`,
  }
}

async function getApprovalCreditSummary(applicationId: string): Promise<ProviderApprovalCreditSummary> {
  const application = await db.providerApplication.findUnique({
    where: { id: applicationId },
    select: {
      providerId: true,
      provider: {
        select: {
          wallet: {
            select: {
              paidCreditBalance: true,
              promoCreditBalance: true,
            },
          },
          promoAwards: {
            where: {
              awardType: 'MOBILE_VERIFIED',
              status: 'AWARDED',
            },
            select: {
              creditsAwarded: true,
              referenceType: true,
              referenceId: true,
            },
            take: 1,
          },
        },
      },
    },
  })

  const wallet = application?.provider?.wallet
  const starterAward = application?.provider?.promoAwards.find((award) => (
    award.referenceType === 'provider_application' &&
    award.referenceId === applicationId
  ))

  return {
    starterPromoCreditsAwarded: starterAward?.creditsAwarded ?? 0,
    paidCredits: wallet?.paidCreditBalance ?? 0,
    promoCredits: wallet?.promoCreditBalance ?? 0,
  }
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
    const credits = await getApprovalCreditSummary(params.applicationId)
    const { mainBody, termsBody } = buildProviderApplicationApprovedMessage(params.name, credits)

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
