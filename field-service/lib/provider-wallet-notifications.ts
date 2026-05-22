import type { MessageStatus, Prisma } from '@prisma/client'
import { db } from './db'
import type { TemplateName } from './messaging-templates'
import { getManualEftBankAccountInstructions } from './provider-credit-payment-intents'
import { sendTemplate } from './whatsapp'
import type { WhatsAppComponent } from './whatsapp'
import { normaliseLocationDisplayName } from './location-format'
import { PROVIDER_CREDITS_PRICE_LINE, getWorkerPortalUrl } from './provider-credit-copy'

const SENT_OR_BETTER: MessageStatus[] = ['SENT', 'DELIVERED', 'READ']

type NotificationPayload = {
  to: string
  templateName: string
  whatsappTemplate: TemplateName
  templateParameters: string[]
  templateComponents?: WhatsAppComponent[]
  body: string
  idempotencyKey: string
  metadata: Record<string, unknown>
  customerId?: string | null
}

type LeadUnlockNotificationContext = {
  unlockId: string
  leadId: string
  providerId: string
  providerName: string
  providerPhone: string
  customerId: string
  customerName: string
  customerPhone: string
  category: string
  area: string
  fullAddress: string
  preferredWindow: string
  description?: string | null
}

export function formatZarFromCents(amountCents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amountCents / 100)
}

function compactLines(lines: Array<string | null | undefined>) {
  return lines.filter((line): line is string => Boolean(line?.trim())).join('\n')
}

function areaLabel(address: {
  street?: string | null
  suburb?: string | null
  city?: string | null
  province?: string | null
} | null | undefined) {
  return [
    normaliseLocationDisplayName(address?.suburb),
    normaliseLocationDisplayName(address?.city),
  ].filter(Boolean).join(', ') || 'Area on file'
}

function fullAddressLabel(address: {
  street?: string | null
  suburb?: string | null
  city?: string | null
  province?: string | null
} | null | undefined) {
  return [
    address?.street,
    normaliseLocationDisplayName(address?.suburb),
    normaliseLocationDisplayName(address?.city),
    normaliseLocationDisplayName(address?.province),
  ].filter(Boolean).join(', ') || 'Address on file'
}

function preferredWindowLabel(jobRequest: {
  requestedWindowStart?: Date | null
  requestedWindowEnd?: Date | null
  requestedArrivalLatest?: Date | null
}) {
  const formatter = new Intl.DateTimeFormat('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  })

  if (jobRequest.requestedWindowStart) {
    const start = formatter.format(jobRequest.requestedWindowStart)
    const end = jobRequest.requestedWindowEnd
      ? new Intl.DateTimeFormat('en-ZA', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Johannesburg',
        }).format(jobRequest.requestedWindowEnd)
      : null
    return end ? `${start}-${end}` : start
  }

  if (jobRequest.requestedArrivalLatest) {
    return `Before ${formatter.format(jobRequest.requestedArrivalLatest)}`
  }

  return 'Flexible'
}

// Body intentionally contains no raw URL. Caller pairs the message with a
// sendCtaUrl follow-up that exposes getWorkerPortalUrl('/provider/credits')
// behind a "Top up credits" / "Open Worker Portal" CTA.
export function buildLowBalanceWarningMessage() {
  return `You have 1 Plug A Pro provider credit left. ${PROVIDER_CREDITS_PRICE_LINE} No credits are used for previewing or saying you are interested. 1 credit is used only when a customer selects you and you accept that selected job. You can continue here on WhatsApp. Tap the button below to top up in the Worker Portal.`
}

// Body intentionally contains no raw URL. Caller pairs with a sendCtaUrl
// follow-up exposing getWorkerPortalUrl('/provider/credits') behind a
// "Top up credits" / "Open Worker Portal" CTA.
export function buildZeroBalanceLeadAvailableMessage() {
  return `New matched lead available, but your wallet has 0 credits. ${PROVIDER_CREDITS_PRICE_LINE} Previewing and saying you are interested are free. You need 1 credit only if the customer selects you and you accept that selected job. You can continue here on WhatsApp. Tap the button below to top up in the Worker Portal.`
}

export function buildPaymentIntentCreatedMessage(params: {
  amountFormatted: string
  creditsToIssue: number
  paymentReference: string
  bankAccount: {
    accountName: string
    bankName: string
    accountNumber: string
    branchCode: string
    accountType: string
  }
}) {
  return compactLines([
    `Provider credits top-up created: ${params.amountFormatted} = ${params.creditsToIssue} credits.`,
    'No credits are used for previewing or saying you are interested.',
    `${PROVIDER_CREDITS_PRICE_LINE} 1 credit is used only when a customer selects you and you accept that selected job.`,
    '',
    'Use these EFT details:',
    `Account: ${params.bankAccount.accountName}`,
    `Bank: ${params.bankAccount.bankName}`,
    `Account number: ${params.bankAccount.accountNumber}`,
    `Branch code: ${params.bankAccount.branchCode}`,
    `Account type: ${params.bankAccount.accountType}`,
    '',
    `Use exact reference: ${params.paymentReference}`,
    'Credits are issued after Plug A Pro confirms the payment.',
  ])
}

export function buildPaymentCreditedMessage(creditsIssued: number) {
  return `Payment received. Your wallet has been credited with ${creditsIssued} Plug A Pro provider credits. ${PROVIDER_CREDITS_PRICE_LINE} 1 credit is used only when a customer selects you and you accept that selected job.`
}

export function buildPayfastTopUpInitiatedMessage(params: {
  amountFormatted: string
  creditsToIssue: number
}) {
  return compactLines([
    `Your Plug A Pro top-up of ${params.amountFormatted} (${params.creditsToIssue} credits) has been initiated.`,
    'Complete your payment on the checkout page.',
    'Credits will appear in your wallet once Payfast confirms payment.',
    `${PROVIDER_CREDITS_PRICE_LINE} 1 credit is used only when a customer selects you and you accept that selected job.`,
  ])
}

export function buildPayatTopUpInitiatedMessage(params: {
  amountFormatted: string
  creditsToIssue: number
  paymentLink?: string
}) {
  return compactLines([
    'Tap the button below to pay for your Plug A Pro wallet top-up.',
    `${params.amountFormatted} = ${params.creditsToIssue} credits.`,
    'You can pay with Pay@ retail cash, QR, or the hosted payment page.',
    'Credits will appear in your wallet once Pay@ confirms payment.',
    `${PROVIDER_CREDITS_PRICE_LINE} 1 credit is used only when a customer selects you and you accept that selected job.`,
  ])
}

export function buildLeadUnlockedProviderMessage(params: LeadUnlockNotificationContext) {
  return compactLines([
    `Lead accepted and unlocked: ${params.category}`,
    `1 credit used. ${PROVIDER_CREDITS_PRICE_LINE}`,
    `Customer: ${params.customerName}`,
    `Phone: ${params.customerPhone}`,
    `Address: ${params.fullAddress}`,
    `Preferred time: ${params.preferredWindow}`,
    params.description ? `Details: ${params.description}` : null,
  ])
}

export function buildCustomerIntroMessage(params: {
  providerName: string
}) {
  return `Good news — we matched you with ${params.providerName}. They may contact you shortly.`
}

function templateBodyComponents(parameters: string[]): WhatsAppComponent[] {
  return [
    {
      type: 'body',
      parameters: parameters.map((text) => ({ type: 'text', text })),
    },
  ]
}

function templateUrlButtonComponent(index: number, url: string): WhatsAppComponent {
  return {
    type: 'button',
    sub_type: 'url',
    index,
    parameters: [{ type: 'text', text: url }],
  }
}

function payatUrlButtonComponent(index: number, paymentLink: string): WhatsAppComponent | null {
  let url: URL
  try {
    url = new URL(paymentLink)
  } catch {
    // H-5: Return null so the caller omits the button entirely rather than
    // passing the raw unparseable string as a WhatsApp URL suffix (which would
    // be appended to the template base URL and produce a broken link).
    console.error('[provider-wallet-notifications] invalid Pay@ payment link URL — omitting button component', { paymentLink })
    return null
  }
  if (url.hostname !== 'go.payat.co.za') {
    console.error('[provider-wallet-notifications] Pay@ payment link hostname mismatch — template button may render incorrectly', { hostname: url.hostname })
  }
  const suffix = `${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`
  return templateUrlButtonComponent(index, suffix)
}

function noExtraNotes(description?: string | null) {
  if (!description?.trim()) return 'No extra notes'
  // WhatsApp template parameters cannot contain newlines or tabs
  return description.replace(/[\r\n\t]+/g, ' ').replace(/\s{5,}/g, '    ').trim()
}

async function hasSentNotification(payload: NotificationPayload) {
  const existing = await db.messageEvent.findFirst({
    where: {
      idempotencyKey: payload.idempotencyKey,
      status: { in: SENT_OR_BETTER },
    },
    select: { id: true },
  })

  return Boolean(existing)
}

async function recordFailedNotification(payload: NotificationPayload, failureReason: string) {
  await db.messageEvent.create({
    data: {
      customerId: payload.customerId ?? undefined,
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
      templateName: payload.templateName,
      body: payload.body,
      to: payload.to,
      idempotencyKey: payload.idempotencyKey,
      status: 'FAILED',
      sentAt: new Date(),
      failureReason,
      metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
    },
  }).catch(() => {})
}

async function sendNotification(payload: NotificationPayload) {
  if (await hasSentNotification(payload)) return { sent: false, skipped: 'duplicate' as const }

  try {
    const externalId = await sendTemplate({
      to: payload.to,
      template: payload.whatsappTemplate,
      components: payload.templateComponents ?? templateBodyComponents(payload.templateParameters),
    })

    await db.messageEvent.create({
      data: {
        customerId: payload.customerId ?? undefined,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: payload.templateName,
        body: payload.body,
        to: payload.to,
        externalId,
        idempotencyKey: payload.idempotencyKey,
        status: 'SENT',
        sentAt: new Date(),
        metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })

    return { sent: true, externalId }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error)
    console.error('[provider-wallet-notifications] WhatsApp send failed', {
      templateName: payload.templateName,
      idempotencyKey: payload.idempotencyKey,
      error: failureReason,
    })
    await recordFailedNotification(payload, failureReason)
    return { sent: false, skipped: 'failed' as const }
  }
}

export async function notifyProviderLowBalance(providerId: string, sourceId?: string) {
  const provider = await db.provider.findUnique({
    where: { id: providerId },
    include: {
      wallet: true,
      walletLedgerEntries: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!provider?.phone || !provider.wallet) return
  const totalCredits = provider.wallet.paidCreditBalance + provider.wallet.promoCreditBalance
  if (totalCredits !== 1) return

  const balanceVersion = sourceId ?? provider.walletLedgerEntries[0]?.id ?? provider.wallet.updatedAt.toISOString()
  await sendNotification({
    to: provider.phone,
    templateName: 'wallet:low_balance',
    whatsappTemplate: 'wallet_low_balance',
    templateParameters: ['1', 'R100', '2'],
    body: buildLowBalanceWarningMessage(),
    idempotencyKey: `wallet:low_balance:${provider.id}:${balanceVersion}`,
    metadata: {
      providerId: provider.id,
      walletId: provider.wallet.id,
      totalCredits,
      balanceVersion,
    },
  })
}

export async function notifyProviderZeroBalanceLeadAvailable(params: {
  providerId: string
  leadId: string
  jobRequestId: string
  holdId?: string
}) {
  const provider = await db.provider.findUnique({
    where: { id: params.providerId },
    include: { wallet: true },
  })

  if (!provider?.phone) return
  const totalCredits = (provider.wallet?.paidCreditBalance ?? 0) + (provider.wallet?.promoCreditBalance ?? 0)
  if (totalCredits !== 0) return

  await sendNotification({
    to: provider.phone,
    templateName: 'wallet:zero_balance_lead_available',
    whatsappTemplate: 'wallet_zero_balance_lead',
    templateParameters: ['0', 'R100'],
    body: buildZeroBalanceLeadAvailableMessage(),
    idempotencyKey: `wallet:zero_balance_lead_available:${params.leadId}`,
    metadata: {
      providerId: params.providerId,
      leadId: params.leadId,
      jobRequestId: params.jobRequestId,
      holdId: params.holdId,
      totalCredits,
    },
  })
}

export async function notifyProviderPaymentIntentCreated(paymentIntentId: string) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: { provider: { select: { id: true, phone: true } } },
  })

  if (!intent?.provider.phone) return

  const bankAccount = getManualEftBankAccountInstructions()
  const amountFormatted = formatZarFromCents(intent.amountCents)

  await sendNotification({
    to: intent.providerCellphone ?? intent.provider.phone,
    templateName: 'wallet:payment_intent_created',
    whatsappTemplate: 'wallet_payment_intent_created',
    templateParameters: [
      amountFormatted,
      String(intent.creditsToIssue),
      bankAccount.accountName,
      bankAccount.bankName,
      bankAccount.accountNumber,
      bankAccount.branchCode,
      bankAccount.accountType,
      intent.paymentReference,
    ],
    body: buildPaymentIntentCreatedMessage({
      amountFormatted,
      creditsToIssue: intent.creditsToIssue,
      paymentReference: intent.paymentReference,
      bankAccount,
    }),
    idempotencyKey: `wallet:payment_intent_created:${intent.id}`,
    metadata: {
      providerId: intent.providerId,
      paymentIntentId: intent.id,
      paymentReference: intent.paymentReference,
      amountCents: intent.amountCents,
      creditsToIssue: intent.creditsToIssue,
    },
  })
}

/**
 * Send a WhatsApp notification when a Payfast gateway top-up is initiated.
 * Only fires for Payfast payment methods (PAYFAST_CARD / PAYFAST_EFT / PAYFAST_SCODE).
 * Failure is non-blocking — the checkout flow must not depend on this succeeding.
 *
 * NOTE: The `wallet_payfast_topup_initiated` WhatsApp template requires approval
 * before messages are delivered in production.
 */
export async function notifyProviderPayfastTopUpInitiated(paymentIntentId: string) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: { provider: { select: { id: true, phone: true } } },
  })

  if (!intent) return
  const phone = intent.providerCellphone ?? intent.provider.phone
  if (!phone) return
  if (!intent.paymentMethod.startsWith('PAYFAST_')) return

  const amountFormatted = formatZarFromCents(intent.amountCents)

  await sendNotification({
    to: phone,
    templateName: 'wallet:payfast_topup_initiated',
    whatsappTemplate: 'wallet_payfast_topup_initiated',
    templateParameters: [amountFormatted, String(intent.creditsToIssue)],
    body: buildPayfastTopUpInitiatedMessage({
      amountFormatted,
      creditsToIssue: intent.creditsToIssue,
    }),
    idempotencyKey: `wallet:payfast_topup_initiated:${intent.id}`,
    metadata: {
      providerId: intent.providerId,
      paymentIntentId: intent.id,
      paymentReference: intent.paymentReference,
      paymentMethod: intent.paymentMethod,
      amountCents: intent.amountCents,
      creditsToIssue: intent.creditsToIssue,
    },
  })
}

export async function notifyProviderPayatTopUpInitiated(
  paymentIntentId: string,
  paymentLink?: string,
) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: { provider: { select: { id: true, phone: true } } },
  })

  if (!intent) return
  const phone = intent.providerCellphone ?? intent.provider.phone
  if (!phone) return
  if (intent.paymentMethod !== 'PAYAT') return
  // H-6: Only send "tap to pay" when the intent is still actionable. Sending
  // this message for a FAILED or EXPIRED intent would deliver a dead payment link.
  if (intent.status !== 'PENDING_PAYMENT') return

  const amountFormatted = formatZarFromCents(intent.amountCents)

  await sendNotification({
    to: phone,
    templateName: 'wallet:payat_topup_initiated',
    whatsappTemplate: 'wallet_payat_topup_initiated',
    templateParameters: [amountFormatted, String(intent.creditsToIssue)],
    templateComponents: (() => {
      const buttonComponent = paymentLink ? payatUrlButtonComponent(0, paymentLink) : null
      return [
        ...templateBodyComponents([amountFormatted, String(intent.creditsToIssue)]),
        ...(buttonComponent !== null ? [buttonComponent] : []),
      ]
    })(),
    body: buildPayatTopUpInitiatedMessage({
      amountFormatted,
      creditsToIssue: intent.creditsToIssue,
    }),
    idempotencyKey: `wallet:payat_topup_initiated:${intent.id}`,
    metadata: {
      providerId: intent.providerId,
      paymentIntentId: intent.id,
      paymentReference: intent.paymentReference,
      paymentMethod: intent.paymentMethod,
      paymentLinkDelivered: true,
      amountCents: intent.amountCents,
      creditsToIssue: intent.creditsToIssue,
    },
  })
}

export async function notifyProviderPaymentCredited(paymentIntentId: string) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: { provider: { select: { id: true, phone: true } } },
  })

  // M-2: Status guard provides a second layer against concurrent webhook
  // delivery racing past the hasSentNotification idempotency check before
  // either MessageEvent is written. The credit gateway commits CREDITED before
  // calling this function, so the guard should always pass in normal operation.
  if (!intent?.provider.phone || intent.status !== 'CREDITED') return

  await sendNotification({
    to: intent.providerCellphone ?? intent.provider.phone,
    templateName: 'wallet:payment_credited',
    whatsappTemplate: 'wallet_payment_credited',
    templateParameters: [String(intent.creditsToIssue)],
    body: buildPaymentCreditedMessage(intent.creditsToIssue),
    idempotencyKey: `wallet:payment_credited:${intent.id}`,
    metadata: {
      providerId: intent.providerId,
      paymentIntentId: intent.id,
      creditsToIssue: intent.creditsToIssue,
      allowTestCohortOverride: true,
    },
  })
}

async function getLeadUnlockNotificationContext(
  unlockId: string,
): Promise<LeadUnlockNotificationContext | null> {
  const unlock = await db.leadUnlock.findUnique({
    where: { id: unlockId },
    include: {
      provider: { select: { id: true, name: true, phone: true } },
      lead: {
        include: {
          jobRequest: {
            include: {
              customer: { select: { id: true, name: true, phone: true } },
              address: true,
            },
          },
        },
      },
    },
  })

  if (!unlock?.provider.phone) return null

  const jobRequest = unlock.lead.jobRequest
  return {
    unlockId: unlock.id,
    leadId: unlock.leadId,
    providerId: unlock.providerId,
    providerName: unlock.provider.name,
    providerPhone: unlock.provider.phone,
    customerId: jobRequest.customer.id,
    customerName: jobRequest.customer.name,
    customerPhone: jobRequest.customer.phone,
    category: jobRequest.category,
    area: areaLabel(jobRequest.address),
    fullAddress: fullAddressLabel(jobRequest.address),
    preferredWindow: preferredWindowLabel(jobRequest),
    description: jobRequest.description,
  }
}

export async function notifyLeadUnlocked(unlockId: string) {
  const context = await getLeadUnlockNotificationContext(unlockId)
  if (!context) return

  await Promise.all([
    sendNotification({
      to: context.providerPhone,
      templateName: 'lead_unlock:provider_confirmation',
      whatsappTemplate: 'lead_unlock_provider',
      templateParameters: [
        context.category,
        context.customerName,
        context.customerPhone,
        context.fullAddress,
        context.preferredWindow,
        noExtraNotes(context.description),
      ],
      body: buildLeadUnlockedProviderMessage(context),
      idempotencyKey: `lead_unlock:provider_confirmation:${context.unlockId}`,
      metadata: {
        leadUnlockId: context.unlockId,
        leadId: context.leadId,
        providerId: context.providerId,
        customerId: context.customerId,
      },
    }),
    sendNotification({
      to: context.customerPhone,
      customerId: context.customerId,
      templateName: 'lead_unlock:customer_intro',
      whatsappTemplate: 'lead_unlock_customer_intro',
      templateParameters: [context.providerName],
      body: buildCustomerIntroMessage({ providerName: context.providerName }),
      idempotencyKey: `lead_unlock:customer_intro:${context.unlockId}`,
      metadata: {
        leadUnlockId: context.unlockId,
        leadId: context.leadId,
        providerId: context.providerId,
        customerId: context.customerId,
      },
    }),
  ])
}
