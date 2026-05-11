import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from './db'
import { LEAD_UNLOCK_COST_CREDITS, LeadUnlockError, unlockLeadForProviderInTransaction } from './lead-unlocks'
import { getJobRequestAccessUrl } from './job-request-access'
import { getProviderSignedJobHandoverUrlByLeadId } from './provider-lead-access'
import { sendText } from './whatsapp'
import { sendCtaUrl } from './whatsapp-interactive'
import { ctaLabelFor } from './whatsapp-copy'
import { PROVIDER_CREDITS_PRICE_LINE } from './provider-credit-copy'

export type SelectedProviderAcceptanceResult =
  | {
      ok: true
      leadId: string
      matchId: string
      jobId: string
      bookingId: string
      creditTransactionId?: string | null
      currentCreditBalance?: number
      alreadyUnlocked?: boolean
      notificationSent: boolean
    }
  | {
      ok: false
      reason:
        | 'NOT_FOUND'
        | 'INSUFFICIENT_CREDITS'
        | 'LEAD_INVITE_NOT_SELECTED'
        | 'PROVIDER_NOT_SELECTED'
        | 'REQUEST_NOT_AWAITING_CONFIRMATION'
        | 'REQUEST_CANCELLED'
        | 'LEAD_NOT_PROVIDER_NOTIFIED'
        | 'LEAD_EXPIRED'
        | 'LEAD_ALREADY_ACCEPTED'
        | 'LEAD_DECLINED'
        | 'DUPLICATE_ACCEPT_IGNORED'
        | 'CREDIT_DEDUCTION_FAILED'
        | 'JOB_ASSIGNMENT_FAILED'
      currentCreditBalance?: number
    }

function remainingBalanceFromLedgerEntries(
  ledgerEntries: Array<{
    balanceAfterPaidCredits?: number | null
    balanceAfterPromoCredits?: number | null
  }> | undefined,
  fallback: number,
) {
  const latest = ledgerEntries?.at(-1)
  if (!latest) return fallback
  return (latest.balanceAfterPaidCredits ?? 0) + (latest.balanceAfterPromoCredits ?? 0)
}

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
  if (!address) return 'Address pending — contact customer'
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

function logProviderLeadAction(params: {
  leadId: string
  providerId: string
  action: 'accept' | 'decline'
  result: string
  source?: string
  traceId?: string
  reason?: string
}) {
  console.info('[provider-lead-action]', {
    leadId: params.leadId,
    providerId: params.providerId,
    action: params.action,
    result: params.result,
    source: params.source ?? 'api',
    traceId: params.traceId ?? null,
    reason: params.reason ?? null,
  })
}

export async function acceptSelectedProviderJob(params: {
  leadId: string
  providerId: string
  source?: 'whatsapp' | 'pwa' | 'api'
  idempotencyKey?: string
  traceId?: string
}): Promise<SelectedProviderAcceptanceResult> {
  logProviderLeadAction({
    leadId: params.leadId,
    providerId: params.providerId,
    action: 'accept',
    result: 'attempt',
    source: params.source,
    traceId: params.traceId,
  })

  let notificationPayload: {
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
  } | null = null

  try {
    const result = await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: params.leadId },
        include: {
          unlock: true,
          provider: {
            select: {
              id: true,
              name: true,
              phone: true,
              active: true,
              verified: true,
              status: true,
            },
          },
          providerResponses: {
            where: { response: 'INTERESTED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          jobRequest: {
            include: {
              customer: { select: { name: true, phone: true } },
              address: true,
              attachments: {
                select: { id: true },
              },
              match: {
                include: {
                  booking: {
                    include: {
                      job: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (!lead) return { ok: false as const, reason: 'NOT_FOUND' as const }
      if (lead.providerId !== params.providerId || lead.jobRequest.selectedProviderId !== params.providerId) {
        return { ok: false as const, reason: 'PROVIDER_NOT_SELECTED' as const }
      }
      if (lead.jobRequest.selectedLeadInviteId !== lead.id || !lead.customerSelectedAt) {
        return { ok: false as const, reason: 'LEAD_INVITE_NOT_SELECTED' as const }
      }

      const walletBefore = await tx.providerWallet.findUnique({
        where: { providerId: params.providerId },
        select: { paidCreditBalance: true, promoCreditBalance: true },
      })
      const currentCreditBalance = (walletBefore?.paidCreditBalance ?? 0) + (walletBefore?.promoCreditBalance ?? 0)

      if (lead.status === 'ACCEPTED' && lead.jobRequest.match?.providerId === params.providerId) {
        return {
          ok: true as const,
          leadId: lead.id,
          matchId: lead.jobRequest.match.id,
          jobId: lead.jobRequest.match.booking?.job?.id ?? '',
          bookingId: lead.jobRequest.match.booking?.id ?? '',
          creditTransactionId: null,
          currentCreditBalance,
          alreadyUnlocked: true,
          duplicateAcceptIgnored: true,
        }
      }
      if (lead.status === 'ACCEPTED' || lead.unlock) {
        return { ok: false as const, reason: 'LEAD_ALREADY_ACCEPTED' as const }
      }
      if (lead.status === 'DECLINED') {
        return { ok: false as const, reason: 'LEAD_DECLINED' as const }
      }
      if (
        lead.status === 'CANCELLED' ||
        lead.cancelledAt ||
        lead.jobRequest.status === 'CANCELLED'
      ) {
        return { ok: false as const, reason: 'REQUEST_CANCELLED' as const }
      }
      if (lead.status === 'EXPIRED' || (lead.expiresAt && lead.expiresAt <= new Date())) {
        return { ok: false as const, reason: 'LEAD_EXPIRED' as const }
      }
      if (lead.status !== 'CUSTOMER_SELECTED') {
        return { ok: false as const, reason: 'LEAD_NOT_PROVIDER_NOTIFIED' as const }
      }
      if (lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING') {
        return { ok: false as const, reason: 'REQUEST_NOT_AWAITING_CONFIRMATION' as const }
      }

      const unlockResult = await unlockLeadForProviderInTransaction(tx, lead.id, params.providerId, {
        source: params.source ?? 'api',
        traceId: params.traceId,
        idempotencyKey: params.idempotencyKey ?? `${params.source ?? 'api'}:${params.providerId}:${lead.id}:selected_accept`,
      })
      const remainingCreditBalance = remainingBalanceFromLedgerEntries(
        unlockResult.ledgerEntries,
        currentCreditBalance,
      )
      const response = lead.providerResponses[0] ?? null
      const scheduledDate = response?.estimatedArrivalAt ?? lead.jobRequest.requestedWindowStart ?? new Date()

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
        where: { id: unlockResult.unlock.id },
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
          notes: 'Created after selected provider final acceptance',
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
          notes: 'Assigned from customer shortlist selection',
        },
      })

      await tx.jobRequest.update({
        where: { id: lead.jobRequestId },
        data: { status: 'MATCHED' },
      })

      await tx.lead.update({
        where: { id: lead.id },
        data: { status: 'ACCEPTED', providerAcceptedAt: new Date(), respondedAt: new Date() },
      })

      await tx.lead.updateMany({
        where: {
          jobRequestId: lead.jobRequestId,
          id: { not: lead.id },
          status: { in: ['SENT', 'VIEWED'] },
        },
        data: { status: 'EXPIRED', expiredAt: new Date(), respondedAt: new Date() },
      })

      await tx.jobStatusEvent.create({
        data: {
          jobId: job.id,
          toStatus: 'SCHEDULED',
          actorId: params.providerId,
          actorRole: 'provider',
          notes: 'Selected provider accepted customer-selected job',
        },
      })

      await tx.auditLog.create({
        data: {
          actorId: params.providerId,
          actorRole: 'provider',
          action: 'shortlist.selected_provider_accept',
          entityType: 'Lead',
          entityId: lead.id,
          after: {
            matchId: match.id,
            bookingId: booking.id,
            jobId: job.id,
            leadUnlockId: unlockResult.unlock.id,
            creditTransactionId: unlockResult.ledgerEntries.at(-1)?.id ?? null,
            source: params.source ?? 'api',
          } as Prisma.InputJsonValue,
        },
      })

      notificationPayload = {
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
        currentCreditBalance: remainingCreditBalance,
        paidCreditBalance: walletBefore?.paidCreditBalance ?? 0,
        promoCreditBalance: walletBefore?.promoCreditBalance ?? 0,
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
      }

      return {
        ok: true as const,
        leadId: lead.id,
        matchId: match.id,
        jobId: job.id,
        bookingId: booking.id,
        creditTransactionId: unlockResult.ledgerEntries.at(-1)?.id ?? null,
        currentCreditBalance: remainingCreditBalance,
        alreadyUnlocked: unlockResult.alreadyUnlocked,
      }
    })

    if (!result.ok) {
      logProviderLeadAction({
        leadId: params.leadId,
        providerId: params.providerId,
        action: 'accept',
        result: 'blocked',
        source: params.source,
        traceId: params.traceId,
        reason: result.reason,
      })
      return result
    }

    const notificationSent = notificationPayload
      ? await notifySelectedAcceptanceCommitted(notificationPayload)
      : false

    logProviderLeadAction({
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'accept',
      result: result.alreadyUnlocked ? 'idempotent' : 'accepted',
      source: params.source,
      traceId: params.traceId,
    })

    return { ...result, notificationSent }
  } catch (error) {
    if (error instanceof LeadUnlockError) {
      if (error.code === 'INSUFFICIENT_CREDITS') {
        return { ok: false, reason: 'INSUFFICIENT_CREDITS', currentCreditBalance: error.currentCreditBalance }
      }
      if (error.code === 'LEAD_NOT_AVAILABLE') {
        return { ok: false, reason: 'LEAD_EXPIRED' }
      }
    }
    console.error('[selected-provider-acceptance] acceptance failed', {
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'accept',
      result: 'error',
      source: params.source ?? 'api',
      traceId: params.traceId ?? null,
      error,
    })
    return { ok: false, reason: 'JOB_ASSIGNMENT_FAILED' }
  }
}

async function notifySelectedAcceptanceCommitted(params: {
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
}) {
  try {
    const [jobUrl, ticketUrl] = await Promise.all([
      getProviderSignedJobHandoverUrlByLeadId(params.leadId),
      getJobRequestAccessUrl(params.requestId, 'job_tracking'),
    ])

    // Provider WhatsApp-complete: include the unlocked customer details
    // inline so the provider can act without opening the PWA. The PWA link
    // is still appended for richer screens but is not required.
    const fullAddress = formatProviderHandoffAddress(params.address)
    const accessLine = params.address?.accessNotes
      ? `\nAccess notes: ${params.address.accessNotes}`
      : ''
    const descriptionLine = params.description?.trim()
      ? `Job description: ${params.description.trim()}\n`
      : ''
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
    console.error('[selected-provider-acceptance] notification failed', {
      leadId: params.leadId,
      providerId: params.providerId,
      error,
    })
    return false
  }
}
