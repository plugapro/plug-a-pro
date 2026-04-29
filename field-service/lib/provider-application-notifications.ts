import { db } from './db'

const APPROVAL_NOTIFICATION_LOCK_STALE_MINUTES = 10

export type ProviderApplicationApprovalNotificationResult =
  | { status: 'sent'; externalId: string }
  | { status: 'skipped'; reason: 'already_sent' | 'send_in_progress' | 'not_found' }

export function buildProviderApplicationApprovedMessage(name: string): string {
  return `✅ *Application approved!*\n\nHi *${name}*, you're now active on Plug A Pro and can receive job leads through this WhatsApp number.\n\nDefault availability: *Available now*\n\nYou can update your working hours in the Worker Portal.\n\nReply *menu* to check your status anytime.`
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
    const { sendText } = await import('./whatsapp-interactive')
    const body = buildProviderApplicationApprovedMessage(params.name)
    const externalId = await sendText(params.phone, body, {
      templateName: 'provider_application_approved',
      metadata: { providerApplicationId: params.applicationId },
    })

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
