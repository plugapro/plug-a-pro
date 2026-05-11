import { Prisma } from '@prisma/client'
import { db } from './db'
import {
  ProviderLeadCreditCheckResult,
  checkProviderLeadCreditBalanceInTransaction,
} from './provider-credit-check'

export type SelectedProviderAcceptanceResult =
  | {
      ok: true
      leadId: string
      creditCheck: ProviderLeadCreditCheckResult
      currentCreditBalance?: number
      alreadyAccepted?: boolean
      notificationSent: boolean
    }
  | {
      ok: false
      reason:
        | 'NOT_FOUND'
        | 'LEAD_INVITE_NOT_SELECTED'
        | 'PROVIDER_NOT_SELECTED'
        | 'REQUEST_NOT_AWAITING_CONFIRMATION'
        | 'REQUEST_CANCELLED'
        | 'LEAD_NOT_PROVIDER_NOTIFIED'
        | 'LEAD_EXPIRED'
        | 'LEAD_ALREADY_ACCEPTED'
        | 'LEAD_DECLINED'
        | 'DUPLICATE_ACCEPT_IGNORED'
        | 'CREDIT_CHECK_FAILED'
      currentCreditBalance?: number
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
  void params.idempotencyKey

  logProviderLeadAction({
    leadId: params.leadId,
    providerId: params.providerId,
    action: 'accept',
    result: 'attempt',
    source: params.source,
    traceId: params.traceId,
  })

  try {
    const result = await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: params.leadId },
        select: {
          id: true,
          providerId: true,
          jobRequestId: true,
          status: true,
          customerSelectedAt: true,
          expiresAt: true,
          cancelledAt: true,
          unlock: { select: { id: true } },
          jobRequest: {
            select: {
              status: true,
              selectedProviderId: true,
              selectedLeadInviteId: true,
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
      if (lead.status === 'DECLINED') {
        return { ok: false as const, reason: 'LEAD_DECLINED' as const }
      }
      if (lead.status === 'ACCEPTED' || lead.unlock) {
        return { ok: false as const, reason: 'LEAD_ALREADY_ACCEPTED' as const }
      }
      if (lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING') {
        return { ok: false as const, reason: 'REQUEST_NOT_AWAITING_CONFIRMATION' as const }
      }

      let alreadyAccepted = false
      if (lead.status === 'CUSTOMER_SELECTED') {
        const acceptedAt = new Date()
        const updated = await tx.lead.updateMany({
          where: { id: lead.id, status: 'CUSTOMER_SELECTED' },
          data: {
            status: 'PROVIDER_ACCEPTED',
            providerAcceptedAt: acceptedAt,
            respondedAt: acceptedAt,
          },
        })

        if (updated.count === 0) {
          return { ok: false as const, reason: 'DUPLICATE_ACCEPT_IGNORED' as const }
        }

        await tx.auditLog.create({
          data: {
            actorId: params.providerId,
            actorRole: 'provider',
            action: 'shortlist.selected_provider_accept',
            entityType: 'Lead',
            entityId: lead.id,
            before: { status: 'CUSTOMER_SELECTED' } as Prisma.InputJsonValue,
            after: {
              status: 'PROVIDER_ACCEPTED',
              source: params.source ?? 'api',
            } as Prisma.InputJsonValue,
          },
        })
      } else if (lead.status === 'PROVIDER_ACCEPTED' || lead.status === 'CREDIT_REQUIRED') {
        alreadyAccepted = true
      } else {
        return { ok: false as const, reason: 'LEAD_NOT_PROVIDER_NOTIFIED' as const }
      }

      const creditCheck = await checkProviderLeadCreditBalanceInTransaction(tx, {
        leadId: lead.id,
        providerId: params.providerId,
        source: params.source,
        traceId: params.traceId,
      })

      return {
        ok: true as const,
        leadId: lead.id,
        creditCheck,
        currentCreditBalance: creditCheck.currentCreditBalance,
        alreadyAccepted,
        notificationSent: false,
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

    logProviderLeadAction({
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'accept',
      result: result.alreadyAccepted ? 'idempotent' : 'accepted',
      source: params.source,
      traceId: params.traceId,
      reason: result.creditCheck.ok ? undefined : result.creditCheck.reason,
    })

    return result
  } catch (error) {
    console.error('[selected-provider-acceptance] acceptance failed', {
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'accept',
      result: 'error',
      source: params.source ?? 'api',
      traceId: params.traceId ?? null,
      error,
    })
    return { ok: false, reason: 'CREDIT_CHECK_FAILED' }
  }
}
