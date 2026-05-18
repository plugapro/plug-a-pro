import { Prisma } from '@prisma/client'
import { db } from './db'
import { hasSuccessfulMessageForRecipient } from './message-events'
import type { TemplateName } from './messaging-templates'
import { sendTemplate, sendText as sendWhatsAppText } from './whatsapp'
import { phoneLookupVariants } from './whatsapp-identity'
import { sendPostMatchIntroductions } from './post-match-intro'
import { notifyPostMatchAcceptance } from './post-match-communications'
import { notifyLeadUnlocked } from './provider-wallet-notifications'
import { materializeFulfilmentArtifacts } from './post-lock-fulfilment'

const CREDIT_APPLICATION_REFERENCE_TYPES = [
  'selected_lead_credit_application',
  'test_selected_lead_credit_application',
] as const

const ACCEPTED_LOCK_CUSTOMER_TEMPLATE = 'mvp1_accepted_lock_customer_confirmation'
const ACCEPTED_LOCK_PROVIDER_TEMPLATE = 'mvp1_accepted_lock_provider_confirmation'
const WHATSAPP_FREEFORM_FALLBACK_WINDOW_MS = 23 * 60 * 60 * 1000

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
  matchId: string
  quoteId: string
  notificationPayload: AcceptedLeadLockNotificationPayload | null
}

type AcceptedLockConfirmationDelivery = {
  sent: boolean
  skipped?: 'duplicate'
  failureReason?: string
}

export type AcceptedLockConfirmationResult =
  | {
      ok: true
      leadId: string
      providerId: string
      serviceRequestId: string
      customer: AcceptedLockConfirmationDelivery
      provider: AcceptedLockConfirmationDelivery
    }
  | {
      ok: false
      reason:
        | 'NOT_FOUND'
        | 'PROVIDER_NOT_SELECTED'
        | 'LEAD_NOT_LOCKED'
        | 'REQUEST_NOT_LOCKED'
      customer?: AcceptedLockConfirmationDelivery
      provider?: AcceptedLockConfirmationDelivery
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
  const payload = {
    leadId: params.leadId,
    providerId: params.providerId,
    serviceRequestId: params.serviceRequestId ?? null,
    action: 'accepted_lock',
    result: params.result,
    source: params.source ?? 'api',
    traceId: params.traceId ?? null,
    reason: params.reason ?? null,
    error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : null,
  }

  if (params.result === 'error' || params.result === 'inconsistent_state') {
    console.error('[provider-accepted-lock]', payload)
    return
  }

  if (params.result === 'blocked') {
    console.warn('[provider-accepted-lock]', payload)
    return
  }

  console.info('[provider-accepted-lock]', payload)
}

function logAcceptedLockConfirmation(params: {
  leadId: string
  providerId: string
  serviceRequestId?: string | null
  recipientRole: 'customer' | 'provider'
  result: string
  traceId?: string
  reason?: string
  error?: unknown
}) {
  console.info('[provider-accepted-lock-confirmation]', {
    leadId: params.leadId,
    providerId: params.providerId,
    serviceRequestId: params.serviceRequestId ?? null,
    recipientRole: params.recipientRole,
    result: params.result,
    traceId: params.traceId ?? null,
    reason: params.reason ?? null,
    error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : null,
  })
}

function failAcceptedLock(params: {
  code: AcceptedLockErrorCode
  message: string
  leadId: string
  providerId: string
  serviceRequestId?: string | null
  source?: 'whatsapp' | 'pwa' | 'api'
  traceId?: string
  result?: 'blocked' | 'inconsistent_state'
}): never {
  logAcceptedLock({
    leadId: params.leadId,
    providerId: params.providerId,
    serviceRequestId: params.serviceRequestId,
    result: params.result ?? 'blocked',
    source: params.source,
    traceId: params.traceId,
    reason: params.code,
  })
  throw new AcceptedLeadLockError(params.code, params.message)
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

  if (!lead) {
    failAcceptedLock({
      code: 'NOT_FOUND',
      message: 'Lead not found.',
      leadId: params.leadId,
      providerId: params.providerId,
      source: params.source,
      traceId: params.traceId,
    })
  }

  if (lead.providerId !== params.providerId) {
    failAcceptedLock({
      code: 'PROVIDER_NOT_SELECTED',
      message: 'This lead belongs to another provider.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }

  const requestLockedByDifferentLead =
    ['ACCEPTED_LOCKED', 'MATCHED'].includes(lead.jobRequest.status) &&
    (lead.jobRequest.selectedProviderId !== params.providerId ||
      lead.jobRequest.selectedLeadInviteId !== lead.id)

  if (requestLockedByDifferentLead) {
    failAcceptedLock({
      code: 'LEAD_ALREADY_LOCKED',
      message: 'This request is already locked to another lead.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }

  if (
    lead.jobRequest.selectedProviderId !== params.providerId ||
    lead.jobRequest.selectedLeadInviteId !== lead.id
  ) {
    failAcceptedLock({
      code: 'PROVIDER_NOT_SELECTED',
      message: 'This lead is not selected for this provider.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }

  if (lead.jobRequest.match && lead.jobRequest.match.providerId !== params.providerId) {
    failAcceptedLock({
      code: 'LEAD_ALREADY_LOCKED',
      message: 'This request is already locked to another provider.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
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

  const leadAlreadyLocked = lead.status === 'ACCEPTED_LOCKED'
  const requestAlreadyLocked = lead.jobRequest.status === 'ACCEPTED_LOCKED'

  if (leadAlreadyLocked !== requestAlreadyLocked) {
    failAcceptedLock({
      code: 'ACCEPTED_LOCK_FAILED',
      message: 'Accepted lock state is inconsistent between lead and request.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
      result: 'inconsistent_state',
    })
  }

  if (leadAlreadyLocked && requestAlreadyLocked) {
    if (!lead.unlock || lead.unlock.providerId !== params.providerId) {
      failAcceptedLock({
        code: 'CREDIT_NOT_APPLIED',
        message: 'Accepted lock is missing the provider credit marker.',
        leadId: lead.id,
        providerId: params.providerId,
        serviceRequestId: lead.jobRequestId,
        source: params.source,
        traceId: params.traceId,
        result: 'inconsistent_state',
      })
    }
    if (!creditTransaction) {
      failAcceptedLock({
        code: 'CREDIT_TRANSACTION_MISSING',
        message: 'Accepted lock is missing the credit transaction.',
        leadId: lead.id,
        providerId: params.providerId,
        serviceRequestId: lead.jobRequestId,
        source: params.source,
        traceId: params.traceId,
        result: 'inconsistent_state',
      })
    }
    // Backfill: leads locked before post-lock fulfilment was wired up may not
    // have a Match row. Materialise it (and a stub Quote) here so the provider
    // portal can surface the job. materializeFulfilmentArtifacts is idempotent
    // — re-entering on an already-materialised lead is a no-op lookup.
    const backfillArtifacts = await materializeFulfilmentArtifacts(tx, {
      jobRequestId: lead.jobRequestId,
      providerId: params.providerId,
    })
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
      matchId: backfillArtifacts.matchId,
      quoteId: backfillArtifacts.quoteId,
      notificationPayload: null,
    }
  }

  if (lead.jobRequest.status === 'CANCELLED' || lead.cancelledAt || lead.status === 'CANCELLED') {
    failAcceptedLock({
      code: 'REQUEST_CANCELLED',
      message: 'This request was cancelled.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }
  if (
    lead.status === 'EXPIRED' ||
    lead.jobRequest.status === 'EXPIRED' ||
    (lead.expiresAt && lead.expiresAt <= new Date()) ||
    (lead.jobRequest.expiresAt && lead.jobRequest.expiresAt <= new Date())
  ) {
    failAcceptedLock({
      code: 'LEAD_EXPIRED',
      message: 'This lead has expired.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }

  if (lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING') {
    failAcceptedLock({
      code: 'LEAD_ALREADY_LOCKED',
      message: 'This request is no longer awaiting provider acceptance.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }
  if (!lead.unlock || lead.unlock.providerId !== params.providerId || lead.status !== 'CREDIT_APPLIED') {
    failAcceptedLock({
      code: 'CREDIT_NOT_APPLIED',
      message: 'Provider credit must be applied before accepted lock.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
  }
  if (!creditTransaction) {
    failAcceptedLock({
      code: 'CREDIT_TRANSACTION_MISSING',
      message: 'Provider credit transaction is required before accepted lock.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
    })
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
    failAcceptedLock({
      code: 'ACCEPTED_LOCK_FAILED',
      message: 'Request changed while applying accepted lock.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
      result: 'inconsistent_state',
    })
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
    failAcceptedLock({
      code: 'ACCEPTED_LOCK_FAILED',
      message: 'Lead changed while applying accepted lock.',
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId: lead.jobRequestId,
      source: params.source,
      traceId: params.traceId,
      result: 'inconsistent_state',
    })
  }

  await tx.lead.updateMany({
    where: {
      jobRequestId: lead.jobRequestId,
      id: { not: lead.id },
      status: { in: ['SEND_PENDING', 'SEND_FAILED'] },
    },
    data: { status: 'SUPERSEDED' },
  })

  await tx.lead.updateMany({
    where: {
      jobRequestId: lead.jobRequestId,
      id: { not: lead.id },
      status: { in: ['SHORTLISTED', 'SENT', 'VIEWED', 'INTERESTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED'] },
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

  // Create the Match + stub Quote so the provider portal can surface the
  // commitment immediately. The stub Quote (amount=0, status=PENDING) is the
  // hand-off point to the provider's quote-submission UI; the customer-facing
  // approval page must guard against showing zero-amount quotes.
  const artifacts = await materializeFulfilmentArtifacts(tx, {
    jobRequestId: lead.jobRequestId,
    providerId: params.providerId,
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
    matchId: artifacts.matchId,
    quoteId: artifacts.quoteId,
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

export async function notifyAcceptedLeadLocked(params: { leadId: string; providerId: string }) {
  try {
    const result = await sendAcceptedLockConfirmations({
      leadId: params.leadId,
      providerId: params.providerId,
    })
    if (!result.ok) return false

    // Fire template-based contact exchange (lead_unlock_provider) — works outside the 24h
    // re-engagement window because it uses a registered template, not an interactive button.
    // Look up the unlock record created during credit application.
    void db.leadUnlock.findFirst({
      where: { leadId: params.leadId, providerId: params.providerId },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    }).then((unlock) => {
      if (unlock) {
        return notifyLeadUnlocked(unlock.id).catch((err: unknown) => {
          console.error('[provider-accepted-lock] notifyLeadUnlocked failed (non-fatal)', {
            leadId: params.leadId,
            unlockId: unlock.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
    }).catch((err: unknown) => {
      console.error('[provider-accepted-lock] unlock lookup for notification failed (non-fatal)', {
        leadId: params.leadId,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    // Fire interactive CTA intro messages (contact exchange) — requires 24h re-engagement
    // window; falls back gracefully when outside the window. The template path above is the
    // reliable fallback for providers who have not messaged recently.
    void sendPostMatchIntroductions({ leadId: params.leadId, providerId: params.providerId })

    // Fire rich acceptance messages with app deep links to both parties (non-blocking).
    // Idempotency is handled inside notifyPostMatchAcceptance via hasSentPostMatchMessage.
    void notifyPostMatchAcceptance({ leadId: params.leadId, providerId: params.providerId })
      .catch((error) => {
        console.error('[provider-accepted-lock-confirmation] post-match deep link notification failed (non-fatal)', {
          leadId: params.leadId,
          providerId: params.providerId,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return !result.customer.failureReason && !result.provider.failureReason
  } catch (error) {
    console.error('[provider-accepted-lock-confirmation]', {
      leadId: params.leadId,
      providerId: params.providerId,
      result: 'failed',
      reason: 'CONFIRMATION_TRIGGER_FAILED',
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function hasAcceptedLockConfirmationSent(params: {
  to: string
  templateName: string
  idempotencyKey: string
}) {
  const existingByKey = await db.messageEvent.findFirst({
    where: {
      to: params.to,
      idempotencyKey: params.idempotencyKey,
      status: { in: ['SENT', 'DELIVERED', 'READ'] },
    },
    select: { id: true },
  })

  if (existingByKey) return true

  return hasSuccessfulMessageForRecipient({
    to: params.to,
    templateName: params.templateName,
    metadataPath: ['idempotencyKey'],
    metadataEquals: params.idempotencyKey,
  })
}

async function reserveAcceptedLockConfirmation(params: {
  to: string
  templateName: string
  body: string
  leadId: string
  providerId: string
  serviceRequestId: string
  recipientRole: 'customer' | 'provider'
  idempotencyKey: string
  traceId?: string
}) {
  try {
    return await db.messageEvent.create({
      data: {
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        templateName: params.templateName,
        body: params.body,
        to: params.to,
        status: 'QUEUED',
        idempotencyKey: params.idempotencyKey,
        metadata: {
          leadId: params.leadId,
          providerId: params.providerId,
          jobRequestId: params.serviceRequestId,
          recipientRole: params.recipientRole,
          idempotencyKey: params.idempotencyKey,
          source: 'accepted_lock_confirmation',
          ...(params.traceId ? { traceId: params.traceId } : {}),
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null
    }
    throw error
  }
}

async function markAcceptedLockConfirmationSent(params: {
  messageEventId: string
  externalId: string
}) {
  await db.messageEvent.updateMany({
    where: {
      id: params.messageEventId,
      status: 'QUEUED',
    },
    data: {
      status: 'SENT',
      externalId: params.externalId,
      sentAt: new Date(),
      failureReason: null,
    },
  })
}

async function markAcceptedLockConfirmationFailed(params: {
  messageEventId: string
  failureReason: string
}) {
  await db.messageEvent.updateMany({
    where: {
      id: params.messageEventId,
      status: 'QUEUED',
    },
    data: {
      status: 'FAILED',
      failureReason: params.failureReason,
      sentAt: new Date(),
    },
  })
}

function isTemplateNotApprovedError(error: unknown) {
  return error instanceof Error && error.message.includes('[TEMPLATE_NOT_APPROVED]')
}

async function hasRecentInboundWhatsappSession(to: string) {
  const cutoff = new Date(Date.now() - WHATSAPP_FREEFORM_FALLBACK_WINDOW_MS)
  const inbound = await db.inboundWhatsAppMessage.findFirst({
    where: {
      phone: { in: phoneLookupVariants(to) },
      firstSeenAt: { gte: cutoff },
    },
    select: { id: true },
  })
  return Boolean(inbound)
}

async function recordAcceptedLockConfirmationFailure(params: {
  to: string
  templateName: string
  body: string
  leadId: string
  providerId: string
  serviceRequestId: string
  recipientRole: 'customer' | 'provider'
  idempotencyKey: string
  failureReason: string
}) {
  await db.messageEvent.create({
    data: {
      channel: 'WHATSAPP',
      direction: 'OUTBOUND',
      templateName: params.templateName,
      body: params.body,
      to: params.to,
      status: 'FAILED',
      sentAt: new Date(),
      failureReason: params.failureReason,
      metadata: {
        leadId: params.leadId,
        providerId: params.providerId,
        jobRequestId: params.serviceRequestId,
        recipientRole: params.recipientRole,
        idempotencyKey: params.idempotencyKey,
        source: 'accepted_lock_confirmation',
      } as Prisma.InputJsonValue,
    },
  }).catch((error) => {
    console.warn('[provider-accepted-lock-confirmation] failed to record failure MessageEvent', {
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

async function sendAcceptedLockConfirmation(params: {
  to: string | null | undefined
  templateName: string
  body: string
  leadId: string
  providerId: string
  serviceRequestId: string
  recipientRole: 'customer' | 'provider'
  idempotencyKey: string
  traceId?: string
}): Promise<AcceptedLockConfirmationDelivery> {
  const to = params.to?.trim()
  if (!to) {
    await recordAcceptedLockConfirmationFailure({
      ...params,
      to: `missing:${params.recipientRole}:${params.leadId}`,
      failureReason: 'WHATSAPP_PHONE_MISSING',
    })
    logAcceptedLockConfirmation({
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      result: 'failed',
      traceId: params.traceId,
      reason: 'WHATSAPP_PHONE_MISSING',
    })
    return { sent: false, failureReason: 'WHATSAPP_PHONE_MISSING' }
  }

  if (await hasAcceptedLockConfirmationSent({
    to,
    templateName: params.templateName,
    idempotencyKey: params.idempotencyKey,
  })) {
    logAcceptedLockConfirmation({
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      result: 'duplicate',
      traceId: params.traceId,
    })
    return { sent: false, skipped: 'duplicate' }
  }

  let reservation: { id: string } | null
  try {
    reservation = await reserveAcceptedLockConfirmation({
      ...params,
      to,
    })
  } catch (error) {
    logAcceptedLockConfirmation({
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      result: 'failed',
      traceId: params.traceId,
      reason: 'RESERVATION_FAILED',
      error,
    })
    return {
      sent: false,
      failureReason: error instanceof Error ? error.message : String(error),
    }
  }

  if (!reservation) {
    logAcceptedLockConfirmation({
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      result: 'duplicate',
      traceId: params.traceId,
      reason: 'IDEMPOTENCY_RESERVED',
    })
    return { sent: false, skipped: 'duplicate' }
  }

  logAcceptedLockConfirmation({
    leadId: params.leadId,
    providerId: params.providerId,
    serviceRequestId: params.serviceRequestId,
    recipientRole: params.recipientRole,
    result: 'attempt',
    traceId: params.traceId,
  })

  try {
    const externalId = await sendTemplate({
      to,
      template: params.templateName as TemplateName,
      components: [],
      metadata: {
        leadId: params.leadId,
        providerId: params.providerId,
        jobRequestId: params.serviceRequestId,
        recipientRole: params.recipientRole,
        idempotencyKey: params.idempotencyKey,
        source: 'accepted_lock_confirmation',
        ...(params.traceId ? { traceId: params.traceId } : {}),
      },
    })
    await markAcceptedLockConfirmationSent({
      messageEventId: reservation.id,
      externalId,
    })
    logAcceptedLockConfirmation({
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      result: 'sent',
      traceId: params.traceId,
    })
    return { sent: true }
  } catch (error) {
    if (isTemplateNotApprovedError(error)) {
      logAcceptedLockConfirmation({
        leadId: params.leadId,
        providerId: params.providerId,
        serviceRequestId: params.serviceRequestId,
        recipientRole: params.recipientRole,
        result: 'fallback_attempt',
        traceId: params.traceId,
        reason: 'TEMPLATE_NOT_APPROVED',
        error,
      })

      try {
        const hasFallbackWindow = await hasRecentInboundWhatsappSession(to)
        if (!hasFallbackWindow) {
          const failureReason = `${error instanceof Error ? error.message : String(error)}; fallback text skipped: NO_ACTIVE_WHATSAPP_SERVICE_WINDOW`
          await markAcceptedLockConfirmationFailed({
            messageEventId: reservation.id,
            failureReason,
          }).catch(async () => {
            await recordAcceptedLockConfirmationFailure({
              ...params,
              to,
              failureReason,
            })
          })
          logAcceptedLockConfirmation({
            leadId: params.leadId,
            providerId: params.providerId,
            serviceRequestId: params.serviceRequestId,
            recipientRole: params.recipientRole,
            result: 'failed',
            traceId: params.traceId,
            reason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
            error,
          })
          return { sent: false, failureReason }
        }

        const externalId = await sendWhatsAppText({
          to,
          text: params.body,
          templateName: `${params.templateName}:fallback_text`,
          metadata: {
            leadId: params.leadId,
            providerId: params.providerId,
            jobRequestId: params.serviceRequestId,
            recipientRole: params.recipientRole,
            idempotencyKey: params.idempotencyKey,
            source: 'accepted_lock_confirmation',
            fallbackReason: 'TEMPLATE_NOT_APPROVED',
            ...(params.traceId ? { traceId: params.traceId } : {}),
          },
          recordMessageEvent: false,
        })
        await markAcceptedLockConfirmationSent({
          messageEventId: reservation.id,
          externalId,
        })
        logAcceptedLockConfirmation({
          leadId: params.leadId,
          providerId: params.providerId,
          serviceRequestId: params.serviceRequestId,
          recipientRole: params.recipientRole,
          result: 'sent_fallback_text',
          traceId: params.traceId,
          reason: 'TEMPLATE_NOT_APPROVED',
        })
        return { sent: true }
      } catch (fallbackError) {
        const fallbackFailureReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        const failureReason = `${error instanceof Error ? error.message : String(error)}; fallback text failed: ${fallbackFailureReason}`
        await markAcceptedLockConfirmationFailed({
          messageEventId: reservation.id,
          failureReason,
        }).catch(async () => {
          await recordAcceptedLockConfirmationFailure({
            ...params,
            to,
            failureReason,
          })
        })
        logAcceptedLockConfirmation({
          leadId: params.leadId,
          providerId: params.providerId,
          serviceRequestId: params.serviceRequestId,
          recipientRole: params.recipientRole,
          result: 'failed',
          traceId: params.traceId,
          reason: 'FALLBACK_TEXT_FAILED',
          error: fallbackError,
        })
        return { sent: false, failureReason }
      }
    }

    const failureReason = error instanceof Error ? error.message : String(error)
    await markAcceptedLockConfirmationFailed({
      messageEventId: reservation.id,
      failureReason,
    }).catch(async () => {
      await recordAcceptedLockConfirmationFailure({
        ...params,
        to,
        failureReason,
      })
    })
    logAcceptedLockConfirmation({
      leadId: params.leadId,
      providerId: params.providerId,
      serviceRequestId: params.serviceRequestId,
      recipientRole: params.recipientRole,
      result: 'failed',
      traceId: params.traceId,
      error,
    })
    return { sent: false, failureReason }
  }
}

export async function sendAcceptedLockConfirmations(params: {
  leadId: string
  providerId: string
  traceId?: string
}): Promise<AcceptedLockConfirmationResult> {
  const lead = await db.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      providerId: true,
      status: true,
      jobRequestId: true,
      provider: { select: { phone: true, name: true } },
      shortlistItems: { select: { customerPreferenceRank: true }, take: 1 },
      jobRequest: {
        select: {
          id: true,
          status: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
          customer: { select: { phone: true } },
        },
      },
    },
  })

  if (!lead) return { ok: false, reason: 'NOT_FOUND' }
  if (
    lead.providerId !== params.providerId ||
    lead.jobRequest.selectedProviderId !== params.providerId ||
    lead.jobRequest.selectedLeadInviteId !== lead.id
  ) {
    return { ok: false, reason: 'PROVIDER_NOT_SELECTED' }
  }
  if (lead.status !== 'ACCEPTED_LOCKED') {
    return { ok: false, reason: 'LEAD_NOT_LOCKED' }
  }
  if (lead.jobRequest.status !== 'ACCEPTED_LOCKED') {
    return { ok: false, reason: 'REQUEST_NOT_LOCKED' }
  }

  const serviceRequestId = lead.jobRequestId
  const customerIdempotencyKey = `accepted_lock_confirmation:customer:${lead.id}:${params.providerId}`
  const providerIdempotencyKey = `accepted_lock_confirmation:provider:${lead.id}:${params.providerId}`
  const prefRank = lead.shortlistItems?.[0]?.customerPreferenceRank
  const { ordinal } = await import('./review-first')
  const providerLabel = prefRank != null
    ? `your ${ordinal(prefRank)} preferred provider, ${lead.provider.name},`
    : `${lead.provider.name}`
  const customerBody =
    `Good news. ${providerLabel} has accepted your request. Your request is confirmed. We will keep you updated on the next step.`
  const providerBody =
    'Job accepted. Your credit has been applied and the customer details are now available in your job view.'

  let customer: AcceptedLockConfirmationDelivery
  let provider: AcceptedLockConfirmationDelivery
  try {
    customer = await sendAcceptedLockConfirmation({
      to: lead.jobRequest.customer.phone,
      templateName: ACCEPTED_LOCK_CUSTOMER_TEMPLATE,
      body: customerBody,
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId,
      recipientRole: 'customer',
      idempotencyKey: customerIdempotencyKey,
      traceId: params.traceId,
    })
  } catch (err) {
    console.error('[provider-accepted-lock] customer notification failed — will not retry automatically:', err)
    customer = { sent: false, failureReason: err instanceof Error ? err.message : String(err) }
  }
  try {
    provider = await sendAcceptedLockConfirmation({
      to: lead.provider.phone,
      templateName: ACCEPTED_LOCK_PROVIDER_TEMPLATE,
      body: providerBody,
      leadId: lead.id,
      providerId: params.providerId,
      serviceRequestId,
      recipientRole: 'provider',
      idempotencyKey: providerIdempotencyKey,
      traceId: params.traceId,
    })
  } catch (err) {
    console.error('[provider-accepted-lock] provider notification failed — will not retry automatically:', err)
    provider = { sent: false, failureReason: err instanceof Error ? err.message : String(err) }
  }

  return {
    ok: true,
    leadId: lead.id,
    providerId: params.providerId,
    serviceRequestId,
    customer,
    provider,
  }
}

export async function notifyNonSelectedRfpProviders(params: {
  acceptedLeadId: string
  traceId?: string
}): Promise<void> {
  const acceptedLead = await db.lead.findUnique({
    where: { id: params.acceptedLeadId },
    select: { jobRequestId: true, jobRequest: { select: { category: true } } },
  })
  if (!acceptedLead) return

  const nonSelectedLeads = await db.lead.findMany({
    where: {
      jobRequestId: acceptedLead.jobRequestId,
      id: { not: params.acceptedLeadId },
      status: 'EXPIRED',
      providerResponses: { some: { response: 'INTERESTED' } },
    },
    select: {
      id: true,
      providerId: true,
      provider: { select: { phone: true, name: true } },
    },
  })

  if (nonSelectedLeads.length === 0) return

  await Promise.allSettled(
    nonSelectedLeads.map(async (lead) => {
      const phone = lead.provider.phone?.trim()
      if (!phone) return

      const idempotencyKey = `rfp_not_selected:${lead.id}`
      const alreadySent = await db.messageEvent.findFirst({
        where: { idempotencyKey, status: { in: ['SENT', 'DELIVERED', 'READ'] } },
        select: { id: true },
      }).catch(() => null)
      if (alreadySent) return

      const ref = lead.id.slice(-6).toUpperCase()
      const firstName = lead.provider.name?.split(' ')[0] ?? 'there'
      const text = [
        `Hi ${firstName} 👋`,
        '',
        `Thank you for your availability on Ref ${ref} (${acceptedLead.jobRequest.category}).`,
        'The customer has confirmed another provider for this job.',
        '',
        'More opportunities will come your way — keep your availability up to date!',
      ].join('\n')

      await sendWhatsAppText({
        to: phone,
        text,
        templateName: 'rfp_not_selected_courtesy',
        metadata: {
          leadId: lead.id,
          providerId: lead.providerId,
          jobRequestId: acceptedLead.jobRequestId,
          source: 'rfp_not_selected',
          idempotencyKey,
          ...(params.traceId ? { traceId: params.traceId } : {}),
        },
        recordMessageEvent: true,
      }).catch((error) => {
        console.warn('[provider-accepted-lock] rfp_not_selected_notify_failed', {
          leadId: lead.id,
          providerId: lead.providerId,
          error: error instanceof Error ? error.message : String(error),
          traceId: params.traceId ?? null,
        })
      })
    }),
  )
}
