import type { MessageStatus } from '@prisma/client'
import { db } from './db'
import type { TemplateName } from './messaging-templates'
import { getManualEftBankAccountInstructions } from './provider-credit-payment-intents'
import { sendTemplate } from './whatsapp'
import type { WhatsAppComponent } from './whatsapp'

const SENT_OR_BETTER: MessageStatus[] = ['SENT', 'DELIVERED', 'READ']

type NotificationPayload = {
  to: string
  templateName: string
  whatsappTemplate: TemplateName
  templateParameters: string[]
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
  return [address?.suburb, address?.city].filter(Boolean).join(', ') || 'Area on file'
}

function fullAddressLabel(address: {
  street?: string | null
  suburb?: string | null
  city?: string | null
  province?: string | null
} | null | undefined) {
  return [address?.street, address?.suburb, address?.city, address?.province]
    .filter(Boolean)
    .join(', ') || 'Address on file'
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

export function buildLowBalanceWarningMessage() {
  return 'You have 1 Plug-A-Pro Credit left. Top up now so you do not miss new leads. R100 = 5 credits.'
}

export function buildZeroBalanceLeadAvailableMessage() {
  return 'New matched lead available, but your wallet has 0 credits. Top up R100 to unlock this and future leads.'
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
    `Plug-A-Pro Credits top-up created: ${params.amountFormatted} = ${params.creditsToIssue} credits.`,
    '',
    'Use these EFT details:',
    `Account: ${params.bankAccount.accountName}`,
    `Bank: ${params.bankAccount.bankName}`,
    `Account number: ${params.bankAccount.accountNumber}`,
    `Branch code: ${params.bankAccount.branchCode}`,
    `Account type: ${params.bankAccount.accountType}`,
    '',
    `Use exact reference: ${params.paymentReference}`,
    'Credits are issued after Plug-A-Pro confirms the payment.',
  ])
}

export function buildPaymentCreditedMessage(creditsIssued: number) {
  return `Payment received. Your wallet has been credited with ${creditsIssued} Plug-A-Pro Credits.`
}

export function buildLeadUnlockedProviderMessage(params: LeadUnlockNotificationContext) {
  return compactLines([
    `Lead unlocked: ${params.category}`,
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

function noExtraNotes(description?: string | null) {
  return description?.trim() || 'No extra notes'
}

async function hasSentNotification(payload: NotificationPayload) {
  const existing = await db.messageEvent.findFirst({
    where: {
      to: payload.to,
      templateName: payload.templateName,
      status: { in: SENT_OR_BETTER },
      metadata: {
        path: ['idempotencyKey'],
        equals: payload.idempotencyKey,
      },
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
      status: 'FAILED',
      sentAt: new Date(),
      failureReason,
      metadata: {
        ...payload.metadata,
        idempotencyKey: payload.idempotencyKey,
      },
    },
  }).catch(() => {})
}

async function sendNotification(payload: NotificationPayload) {
  if (await hasSentNotification(payload)) return { sent: false, skipped: 'duplicate' as const }

  try {
    const externalId = await sendTemplate({
      to: payload.to,
      template: payload.whatsappTemplate,
      components: templateBodyComponents(payload.templateParameters),
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
        status: 'SENT',
        sentAt: new Date(),
        metadata: {
          ...payload.metadata,
          idempotencyKey: payload.idempotencyKey,
        },
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
    templateParameters: ['1', 'R100', '5'],
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

export async function notifyProviderPaymentCredited(paymentIntentId: string) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: { provider: { select: { id: true, phone: true } } },
  })

  if (!intent?.provider.phone || intent.status !== 'CREDITED') return

  await sendNotification({
    to: intent.provider.phone,
    templateName: 'wallet:payment_credited',
    whatsappTemplate: 'wallet_payment_credited',
    templateParameters: [String(intent.creditsToIssue)],
    body: buildPaymentCreditedMessage(intent.creditsToIssue),
    idempotencyKey: `wallet:payment_credited:${intent.id}`,
    metadata: {
      providerId: intent.providerId,
      paymentIntentId: intent.id,
      creditsToIssue: intent.creditsToIssue,
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
