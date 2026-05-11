import { Prisma } from '@prisma/client'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import { getJobRequestAccessUrl } from './job-request-access'
import { getProviderLeadAccessUrl } from './provider-lead-access'
import { PROVIDER_CREDITS_PRICE_LINE } from './provider-credit-copy'
import { ctaLabelFor } from './whatsapp-copy'
import { sendText } from './whatsapp'
import { sendCtaUrl } from './whatsapp-interactive'

const CREDIT_APPLICATION_REFERENCE_TYPES = [
  'selected_lead_credit_application',
  'test_selected_lead_credit_application',
] as const

type AcceptedLockErrorCode =
  | 'NOT_FOUND'
  | 'PROVIDER_NOT_SELECTED'
  | 'CREDIT_NOT_APPLIED'
  | 'CREDIT_TRANSACTION_MISSING'
  | 'REQUEST_CANCELLED'
  | 'LEAD_EXPIRED'
  | 'LEAD_ALREADY_LOCKED'
  | 'ACCEPTED_LOCK_FAILED'

export class AcceptedLeadLockError extends Error {
  constructor(
    public readonly code: AcceptedLockErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AcceptedLeadLockError'
  }
}

export type AcceptedLeadLockResult = {
  ok: true
  leadId: string
  providerId: string
  serviceRequestId: string
  leadStatus: 'ACCEPTED_LOCKED'
  serviceRequestStatus: 'ACCEPTED_LOCKED'
  creditTransactionId: string
  alreadyLocked: boolean
  notificationPayload: AcceptedLeadLockNotificationPayload | null
}

type AcceptedLeadLockNotificationPayload = {
  leadId: string
  providerId: string
  providerPhone: string
  customerPhone: string
  customerName: string
  providerName: string
  category: string
  requestId: string
  description: string | null
  preferredWindowStart: Date | null
  preferredWindowEnd: Date | null
  photosCount: number
  estimatedArrivalAt: Date | null
  callOutFee: Prisma.Decimal | number | null
  currentCreditBalance: number
  paidCreditBalance: number
  promoCreditBalance: number
  address: {
    street: string
    addressLine1: string | null
    addressLine2: string | null
    complexName: string | null
    unitNumber: string | null
    suburb: string
    city: string
    province: string
    accessNotes: string | null
  } | null
}

type AcceptedLockTx = Prisma.TransactionClient

function formatRand(amount: number | Prisma.Decimal | null | undefined) {
  if (amount == null) return 'Not provided'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(amount))
}

function formatProviderHandoffAddress(address: {
  street: string
  addressLine1: string | null
  addressLine2: string | null
  complexName: string | null
  unitNumber: string | null
  suburb: string
  city: string
  province: string
} | null) {
  if (!address) return 'Address pending - contact customer'
  return [
    address.unitNumber,
    address.complexName,
    address.street,
    address.addressLine1,
    address.addressLine2,
    address.suburb,
    address.city,
    address.province,
  ].filter(Boolean).join(', ')
}

function formatPreferredTime(start: Date | null | undefined, end: Date | null | undefined) {
  if (!start) return 'To be confirmed'
  const startText = start.toLocaleString('en-ZA')
  return end ? `${startText} - ${end.toLocaleString('en-ZA')}` : startText
}

function logAcceptedLock(params: {
  leadId: string
  providerId: string
  serviceRequestId?: string | null
  result: string
  source?: string
  traceId?: string
  reason?: string
  error?: unknown
}) {
  console.info('[provider-accepted-lock]', {
    leadId: params.leadId,
    providerId: params.providerId,
    serviceRequestId: params.serviceRequestId ?? null,
    action: 'accepted_lock',
    result: params.result,
    source: params.source ?? 'api',
    traceId: params.traceId ?? null,
    reason: params.reason ?? null,
    error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : null,
  })
}

export async function lockAcceptedLeadAfterCreditInTransaction(
  tx: AcceptedLockTx,
  params: {
    leadId: string
    providerId: string
    source?: 'whatsapp' | 'pwa' | 'api'
    traceId?: string
    currentCreditBalance?: number
    paidCreditBalance?: number
    promoCreditBalance?: number
  },
): Promise<AcceptedLeadLockResult> {
  logAcceptedLock({
    leadId: params.leadId,
    providerId: params.providerId,
    result: 'attempt',
    source: params.source,
    traceId: params.traceId,
  })

  const lead = await tx.lead.findUnique({
    where: { id: params.leadId },
    include: {
      unlock: true,
      provider: { select: { id: true, name: true, phone: true } },
      providerResponses: {
        where: { response: 'INTERESTED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      jobRequest: {
        include: {
          customer: { select: { name: true, phone: true } },
          address: true,
          attachments: { select: { id: true } },
          match: { select: { id: true, providerId: true, status: true } },
        },
      },
    },
  })

  if (!lead) throw new AcceptedLeadLockError('NOT_FOUND', 'Lead not found.')
  if (
    lead.providerId !== params.providerId ||
    lead.jobRequest.selectedProviderId !== params.providerId ||
    lead.jobRequest.selectedLeadInviteId !== lead.id
  ) {
    throw new AcceptedLeadLockError('PROVIDER_NOT_SELECTED', 'This lead belongs to another provider.')
  }
  if (lead.jobRequest.status === 'CANCELLED' || lead.cancelledAt || lead.status === 'CANCELLED') {
    throw new AcceptedLeadLockError('REQUEST_CANCELLED', 'This request was cancelled.')
  }
  if (lead.status === 'EXPIRED' || lead.jobRequest.status === 'EXPIRED') {
    throw new AcceptedLeadLockError('LEAD_EXPIRED', 'This lead has expired.')
  }
  if (lead.jobRequest.match && lead.jobRequest.match.providerId !== params.providerId) {
    throw new AcceptedLeadLockError('LEAD_ALREADY_LOCKED', 'This request is already locked to another provider.')
  }

  const creditTransaction = await tx.walletLedgerEntry.findFirst({
    where: {
      providerId: params.providerId,
      entryType: 'LEAD_UNLOCK_DEBIT',
      referenceType: { in: [...CREDIT_APPLICATION_REFERENCE_TYPES] },
      referenceId: lead.id,
    },
    orderBy: { createdAt: 'desc' },
  })

  const isAlreadyLocked =
    lead.status === 'ACCEPTED_LOCKED' ||
    (lead.status === 'ACCEPTED' && ['ACCEPTED_LOCKED', 'MATCHED'].includes(lead.jobRequest.status))

  if (isAlreadyLocked) {
    if (!lead.unlock || lead.unlock.providerId !== params.providerId) {
      throw new AcceptedLeadLockError('CREDIT_NOT_APPLIED', 'Accepted lock is missing the provider credit marker.')
    }
    if (!creditTransaction) {
      throw new AcceptedLeadLockError('CREDIT_TRANSACTION_MISSING', 'Accepted lock is missing the credit transaction.')
    }
    logAcceptedLock({
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      result: 'idempotent',
      source: params.source,
      traceId: params.traceId,
    })
    return {
      ok: true,
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      leadStatus: 'ACCEPTED_LOCKED',
      serviceRequestStatus: 'ACCEPTED_LOCKED',
      creditTransactionId: creditTransaction.id,
      alreadyLocked: true,
      notificationPayload: null,
    }
  }

  if (lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING') {
    throw new AcceptedLeadLockError('LEAD_ALREADY_LOCKED', 'This request is no longer awaiting provider acceptance.')
  }
  if (!lead.unlock || lead.unlock.providerId !== params.providerId || lead.status !== 'CREDIT_APPLIED') {
    throw new AcceptedLeadLockError('CREDIT_NOT_APPLIED', 'Provider credit must be applied before accepted lock.')
  }
  if (!creditTransaction) {
    throw new AcceptedLeadLockError('CREDIT_TRANSACTION_MISSING', 'Provider credit transaction is required before accepted lock.')
  }

  const wallet = await tx.providerWallet.findUnique({
    where: { providerId: params.providerId },
    select: { paidCreditBalance: true, promoCreditBalance: true },
  })
  const paidCreditBalance = params.paidCreditBalance ?? wallet?.paidCreditBalance ?? 0
  const promoCreditBalance = params.promoCreditBalance ?? wallet?.promoCreditBalance ?? 0
  const currentCreditBalance = params.currentCreditBalance ?? paidCreditBalance + promoCreditBalance
  const response = lead.providerResponses[0] ?? null
  const lockedAt = new Date()

  // Transactional and idempotent by design: request and lead status are guarded
  // with current-state predicates so competing requests cannot lock the same
  // customer-selected request or create a second final acceptance.
  const requestUpdated = await tx.jobRequest.updateMany({
    where: {
      id: lead.jobRequestId,
      status: 'PROVIDER_CONFIRMATION_PENDING',
      selectedProviderId: params.providerId,
      selectedLeadInviteId: lead.id,
    },
    data: { status: 'ACCEPTED_LOCKED' },
  })
  if (requestUpdated.count !== 1) {
    throw new AcceptedLeadLockError('ACCEPTED_LOCK_FAILED', 'Request changed while applying accepted lock.')
  }

  const leadUpdated = await tx.lead.updateMany({
    where: { id: lead.id, status: 'CREDIT_APPLIED', providerId: params.providerId },
    data: {
      status: 'ACCEPTED_LOCKED',
      providerAcceptedAt: lead.providerAcceptedAt ?? lockedAt,
      respondedAt: lockedAt,
    },
  })
  if (leadUpdated.count !== 1) {
    throw new AcceptedLeadLockError('ACCEPTED_LOCK_FAILED', 'Lead changed while applying accepted lock.')
  }

  await tx.lead.updateMany({
    where: {
      jobRequestId: lead.jobRequestId,
      id: { not: lead.id },
      status: { in: ['SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED'] },
    },
    data: { status: 'EXPIRED', expiredAt: lockedAt, respondedAt: lockedAt },
  })

  await tx.auditLog.create({
    data: {
      actorId: params.providerId,
      actorRole: 'provider',
      action: 'lead.provider_accepted_locked',
      entityType: 'Lead',
      entityId: lead.id,
      before: {
        leadStatus: 'CREDIT_APPLIED',
        serviceRequestStatus: 'PROVIDER_CONFIRMATION_PENDING',
      } as Prisma.InputJsonValue,
      after: {
        leadStatus: 'ACCEPTED_LOCKED',
        serviceRequestStatus: 'ACCEPTED_LOCKED',
        leadUnlockId: lead.unlock.id,
        creditTransactionId: creditTransaction.id,
        source: params.source ?? 'api',
      } as Prisma.InputJsonValue,
    },
  })

  logAcceptedLock({
    leadId: lead.id,
    providerId: params.providerId,
    serviceRequestId: lead.jobRequestId,
    result: 'success',
    source: params.source,
    traceId: params.traceId,
  })

  return {
    ok: true,
    leadId: lead.id,
    providerId: params.providerId,
    serviceRequestId: lead.jobRequestId,
    leadStatus: 'ACCEPTED_LOCKED',
    serviceRequestStatus: 'ACCEPTED_LOCKED',
    creditTransactionId: creditTransaction.id,
    alreadyLocked: false,
    notificationPayload: {
      leadId: lead.id,
      providerId: params.providerId,
      providerPhone: lead.provider.phone,
      customerPhone: lead.jobRequest.customer.phone,
      customerName: lead.jobRequest.customer.name,
      providerName: lead.provider.name,
      category: lead.jobRequest.category,
      requestId: lead.jobRequestId,
      description: lead.jobRequest.description,
      preferredWindowStart: lead.jobRequest.requestedWindowStart,
      preferredWindowEnd: lead.jobRequest.requestedWindowEnd,
      photosCount: lead.jobRequest.attachments.length,
      estimatedArrivalAt: response?.estimatedArrivalAt ?? null,
      callOutFee: response?.callOutFee ?? null,
      currentCreditBalance,
      paidCreditBalance,
      promoCreditBalance,
      address: lead.jobRequest.address
        ? {
            street: lead.jobRequest.address.street,
            addressLine1: lead.jobRequest.address.addressLine1,
            addressLine2: lead.jobRequest.address.addressLine2,
            complexName: lead.jobRequest.address.complexName,
            unitNumber: lead.jobRequest.address.unitNumber,
            suburb: lead.jobRequest.address.suburb,
            city: lead.jobRequest.address.city,
            province: lead.jobRequest.address.province,
            accessNotes: lead.jobRequest.address.accessNotes,
          }
        : null,
    },
  }
}

export async function notifyAcceptedLeadLocked(params: AcceptedLeadLockNotificationPayload) {
  try {
    const [providerLeadUrl, ticketUrl] = await Promise.all([
      getProviderLeadAccessUrl({
        leadId: params.leadId,
        providerId: params.providerId,
        jobRequestId: params.requestId,
        providerPhone: params.providerPhone,
      }),
      getJobRequestAccessUrl(params.requestId, 'job_tracking'),
    ])

    const fullAddress = formatProviderHandoffAddress(params.address)
    const accessLine = params.address?.accessNotes ? `\nAccess notes: ${params.address.accessNotes}` : ''
    const descriptionLine = params.description?.trim() ? `Job description: ${params.description.trim()}\n` : ''
    const photosLine = params.photosCount > 0
      ? `Photos: ${params.photosCount} available in the lead link\n`
      : 'Photos: None uploaded\n'
    const jobReference = params.leadId.slice(-8).toUpperCase()

    await sendText({
      to: params.providerPhone,
      text:
        `✅ Job accepted and locked\n\n` +
        `Credit applied: ${LEAD_UNLOCK_COST_CREDITS}. ${PROVIDER_CREDITS_PRICE_LINE}\n` +
        `Available balance: ${params.currentCreditBalance} credits\n` +
        `Starter/onboarding: ${params.promoCreditBalance}\n` +
        `Purchased: ${params.paidCreditBalance}\n\n` +
        `Customer details:\n` +
        `Name: ${params.customerName}\n` +
        `Phone: ${params.customerPhone}\n` +
        `Address: ${fullAddress}${accessLine}\n\n` +
        `Request details:\n` +
        `Reference: ${jobReference}\n` +
        `Preferred time: ${formatPreferredTime(params.preferredWindowStart, params.preferredWindowEnd)}\n` +
        descriptionLine +
        photosLine +
        `\nMVP1 is complete for this request. Use the lead link for the accepted details.`,
      templateName: 'interactive:selected_job_accepted_provider',
      metadata: { leadId: params.leadId, providerId: params.providerId },
    })
    if (providerLeadUrl) {
      await sendCtaUrl(
        params.providerPhone,
        'Accepted lead details are available below.',
        ctaLabelFor('generic_details'),
        providerLeadUrl,
        undefined,
        { templateName: 'interactive:selected_job_accepted_provider_cta', metadata: { leadId: params.leadId, providerId: params.providerId } },
      )
    }

    await sendText({
      to: params.customerPhone,
      text:
        `✅ Your provider accepted the request\n\n` +
        `Provider: ${params.providerName}\n` +
        `Expected arrival: ${params.estimatedArrivalAt?.toLocaleString('en-ZA') ?? 'To be confirmed'}\n` +
        `Call-out fee: ${formatRand(params.callOutFee)}` +
        (ticketUrl ? `\n\nYour request details are available below.` : ''),
      templateName: 'interactive:selected_job_accepted_customer',
      metadata: { leadId: params.leadId, providerId: params.providerId },
    })
    if (ticketUrl) {
      await sendCtaUrl(
        params.customerPhone,
        'Your request is available below.',
        ctaLabelFor('generic_details'),
        ticketUrl,
        undefined,
        { templateName: 'interactive:selected_job_accepted_customer_cta', metadata: { leadId: params.leadId, providerId: params.providerId } },
      )
    }

    return true
  } catch (error) {
    console.error('[provider-accepted-lock] notification failed', {
      leadId: params.leadId,
      providerId: params.providerId,
      error,
    })
    return false
  }
}
