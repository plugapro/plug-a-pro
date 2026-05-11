import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import { getJobRequestAccessUrl } from './job-request-access'
import { getProviderSignedJobHandoverUrlByLeadId } from './provider-lead-access'
import { PROVIDER_CREDITS_PRICE_LINE } from './provider-credit-copy'
import { ctaLabelFor } from './whatsapp-copy'
import { sendText } from './whatsapp'
import { sendCtaUrl } from './whatsapp-interactive'

type AcceptedLockErrorCode =
  | 'NOT_FOUND'
  | 'PROVIDER_NOT_SELECTED'
  | 'CREDIT_NOT_APPLIED'
  | 'REQUEST_CANCELLED'
  | 'LEAD_EXPIRED'
  | 'LEAD_ALREADY_LOCKED'
  | 'JOB_ASSIGNMENT_FAILED'

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
  matchId: string
  bookingId: string
  jobId: string
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
  result: string
  source?: string
  traceId?: string
  matchId?: string | null
  reason?: string
  error?: unknown
}) {
  console.info('[provider-accepted-lock]', {
    leadId: params.leadId,
    providerId: params.providerId,
    action: 'accepted_lock',
    result: params.result,
    source: params.source ?? 'api',
    traceId: params.traceId ?? null,
    matchId: params.matchId ?? null,
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
          match: {
            include: {
              booking: {
                include: { job: true },
              },
            },
          },
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

  const existingMatch = lead.jobRequest.match
  if (lead.status === 'ACCEPTED' && existingMatch?.providerId === params.providerId) {
    const booking = existingMatch.booking
    const job = booking?.job
    if (!booking || !job) {
      throw new AcceptedLeadLockError('JOB_ASSIGNMENT_FAILED', 'Accepted lead is missing assignment records.')
    }
    logAcceptedLock({
      leadId: lead.id,
      providerId: params.providerId,
      result: 'idempotent',
      source: params.source,
      traceId: params.traceId,
      matchId: existingMatch.id,
    })
    return {
      ok: true,
      leadId: lead.id,
      providerId: params.providerId,
      matchId: existingMatch.id,
      bookingId: booking.id,
      jobId: job.id,
      alreadyLocked: true,
      notificationPayload: null,
    }
  }
  if (existingMatch && existingMatch.providerId !== params.providerId) {
    throw new AcceptedLeadLockError('LEAD_ALREADY_LOCKED', 'This request is already locked to another provider.')
  }
  if (!lead.unlock || lead.unlock.providerId !== params.providerId || lead.status !== 'CREDIT_APPLIED') {
    throw new AcceptedLeadLockError('CREDIT_NOT_APPLIED', 'Provider credit must be applied before accepting lock.')
  }

  const wallet = await tx.providerWallet.findUnique({
    where: { providerId: params.providerId },
    select: { paidCreditBalance: true, promoCreditBalance: true },
  })
  const paidCreditBalance = params.paidCreditBalance ?? wallet?.paidCreditBalance ?? 0
  const promoCreditBalance = params.promoCreditBalance ?? wallet?.promoCreditBalance ?? 0
  const currentCreditBalance = params.currentCreditBalance ?? paidCreditBalance + promoCreditBalance
  const response = lead.providerResponses[0] ?? null
  const scheduledDate = response?.estimatedArrivalAt ?? lead.jobRequest.requestedWindowStart ?? new Date()

  // This function is always called inside the same transaction that confirmed
  // credit application. The Match/Booking/Job records and Lead ACCEPTED status
  // must commit together so a retry can be handled by the ACCEPTED branch above
  // instead of creating a second assignment or exposing details without a job.
  const match = await tx.match.create({
    data: {
      jobRequestId: lead.jobRequestId,
      providerId: params.providerId,
      status: 'QUOTE_APPROVED',
      inspectionNeeded: false,
      plannedArrivalStart: response?.estimatedArrivalAt ?? null,
    },
  })

  await tx.leadUnlock.update({
    where: { id: lead.unlock.id },
    data: { matchId: match.id },
  })

  const quote = await tx.quote.create({
    data: {
      matchId: match.id,
      amount: response?.callOutFee ?? 0,
      labourCost: response?.callOutFee ?? 0,
      materialsCost: 0,
      description: `Customer-selected ${lead.jobRequest.category} job`,
      preferredDate: scheduledDate,
      approvalToken: randomUUID(),
      status: 'APPROVED',
      approvedAt: new Date(),
      notes: 'Auto-approved from customer shortlist provider selection',
    },
  })

  const booking = await tx.booking.create({
    data: {
      matchId: match.id,
      quoteId: quote.id,
      status: 'SCHEDULED',
      scheduledDate,
      scheduledStartAt: scheduledDate,
      notes: 'Created after selected provider accepted lock',
    },
  })

  const job = await tx.job.create({
    data: {
      bookingId: booking.id,
      providerId: params.providerId,
      jobRef: `PAP-JOB-${lead.id.slice(-8).toUpperCase()}`,
      selectedLeadInviteId: lead.id,
      status: 'SCHEDULED',
      isTestJob: lead.isTestLead || lead.jobRequest.isTestRequest,
      cohortName: lead.cohortName ?? lead.jobRequest.cohortName,
      assignedAt: new Date(),
      scheduledArrivalAt: scheduledDate,
      notes: 'Assigned from customer shortlist selection after credit application',
    },
  })

  await tx.jobRequest.update({
    where: { id: lead.jobRequestId },
    data: { status: 'MATCHED' },
  })

  const leadUpdated = await tx.lead.updateMany({
    where: { id: lead.id, status: 'CREDIT_APPLIED' },
    data: { status: 'ACCEPTED', providerAcceptedAt: lead.providerAcceptedAt ?? new Date(), respondedAt: new Date() },
  })
  if (leadUpdated.count !== 1) {
    throw new AcceptedLeadLockError('JOB_ASSIGNMENT_FAILED', 'Lead changed while applying accepted lock.')
  }

  await tx.lead.updateMany({
    where: {
      jobRequestId: lead.jobRequestId,
      id: { not: lead.id },
      status: { in: ['SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED', 'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
    },
    data: { status: 'EXPIRED', expiredAt: new Date(), respondedAt: new Date() },
  })

  await tx.jobStatusEvent.create({
    data: {
      jobId: job.id,
      toStatus: 'SCHEDULED',
      actorId: params.providerId,
      actorRole: 'provider',
      notes: 'Selected provider accepted lock completed',
    },
  })

  await tx.auditLog.create({
    data: {
      actorId: params.providerId,
      actorRole: 'provider',
      action: 'lead.provider_accepted_locked',
      entityType: 'Lead',
      entityId: lead.id,
      before: { status: 'CREDIT_APPLIED' } as Prisma.InputJsonValue,
      after: {
        status: 'ACCEPTED',
        matchId: match.id,
        bookingId: booking.id,
        jobId: job.id,
        leadUnlockId: lead.unlock.id,
        source: params.source ?? 'api',
      } as Prisma.InputJsonValue,
    },
  })

  logAcceptedLock({
    leadId: lead.id,
    providerId: params.providerId,
    result: 'success',
    source: params.source,
    traceId: params.traceId,
    matchId: match.id,
  })

  return {
    ok: true,
    leadId: lead.id,
    providerId: params.providerId,
    matchId: match.id,
    bookingId: booking.id,
    jobId: job.id,
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
    const [jobUrl, ticketUrl] = await Promise.all([
      getProviderSignedJobHandoverUrlByLeadId(params.leadId),
      getJobRequestAccessUrl(params.requestId, 'job_tracking'),
    ])

    const fullAddress = formatProviderHandoffAddress(params.address)
    const accessLine = params.address?.accessNotes ? `\nAccess notes: ${params.address.accessNotes}` : ''
    const descriptionLine = params.description?.trim() ? `Job description: ${params.description.trim()}\n` : ''
    const photosLine = params.photosCount > 0
      ? `Photos: ${params.photosCount} available in the job link\n`
      : 'Photos: None uploaded\n'
    const jobReference = params.leadId.slice(-8).toUpperCase()

    await sendText({
      to: params.providerPhone,
      text:
        `✅ Job accepted\n\n` +
        `You used ${LEAD_UNLOCK_COST_CREDITS} credit. ${PROVIDER_CREDITS_PRICE_LINE}\n` +
        `Available balance: ${params.currentCreditBalance} credits\n` +
        `Starter/onboarding: ${params.promoCreditBalance}\n` +
        `Purchased: ${params.paidCreditBalance}\n\n` +
        `Full customer details are now unlocked.\n\n` +
        `Customer details:\n` +
        `Name: ${params.customerName}\n` +
        `Phone: ${params.customerPhone}\n` +
        `Address: ${fullAddress}${accessLine}\n\n` +
        `Job details:\n` +
        `Reference: ${jobReference}\n` +
        `Preferred time: ${formatPreferredTime(params.preferredWindowStart, params.preferredWindowEnd)}\n` +
        descriptionLine +
        photosLine +
        `\nNext step:\nReply with your arrival time.\nExample: 14:00${jobUrl ? `\n\nJob details and photos are available below.` : ''}`,
      templateName: 'interactive:selected_job_accepted_provider',
      metadata: { leadId: params.leadId, providerId: params.providerId },
    })
    if (jobUrl) {
      await sendCtaUrl(
        params.providerPhone,
        'Job details and photos are available below.',
        ctaLabelFor('job_detail'),
        jobUrl,
        undefined,
        { templateName: 'interactive:selected_job_accepted_provider_cta', metadata: { leadId: params.leadId, providerId: params.providerId } },
      )
    }

    await sendText({
      to: params.customerPhone,
      text:
        `✅ Your provider accepted the job\n\n` +
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
