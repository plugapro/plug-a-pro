import { Prisma } from '@prisma/client'
import { db } from './db'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import {
  ProviderCreditApplicationError,
  applyProviderCreditForAcceptedLeadInTransaction,
} from './provider-credit-application'
import type { ProviderCreditApplicationResult } from './provider-credit-application'
import {
  AcceptedLeadLockError,
  lockAcceptedLeadAfterCreditInTransaction,
  notifyAcceptedLeadLocked,
  notifyNonSelectedRfpProviders,
} from './provider-accepted-lock'
import type { AcceptedLeadLockResult } from './provider-accepted-lock'
import {
  ProviderLeadCreditCheckResult,
  checkProviderLeadCreditBalanceInTransaction,
} from './provider-credit-check'
import {
  IdentityCreditGateError,
  assertIdentityVerifiedForCredits,
} from './identity-verification/credit-gate'
import { recordWorkflowEvent } from './workflow-events/record'

const SELECTED_PROVIDER_ACCEPTANCE_TRANSACTION_TIMEOUT_MS = 20_000
const SELECTED_PROVIDER_ACCEPTANCE_TRANSACTION_MAX_WAIT_MS = 10_000

export type SelectedProviderAcceptanceResult =
  | {
      ok: true
      leadId: string
      creditCheck: ProviderLeadCreditCheckResult
      creditApplication?: ProviderCreditApplicationResult
      acceptedLock?: Omit<AcceptedLeadLockResult, 'notificationPayload'>
      currentCreditBalance?: number
      alreadyAccepted?: boolean
      alreadyUnlocked?: boolean
      creditApplied?: boolean
      matchId?: string | null
      jobId?: string | null
      bookingId?: string | null
      creditTransactionId?: string | null
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
        | 'IDENTITY_NOT_VERIFIED'
        | 'CREDIT_CHECK_FAILED'
        | 'CREDIT_REQUIRED'
        | 'INSUFFICIENT_CREDITS'
        | 'CREDIT_APPLICATION_FAILED'
        | 'JOB_ASSIGNMENT_FAILED'
      currentCreditBalance?: number
      // Surfaces the underlying credit-check failure so callers can render the
      // appropriate top-up / wallet messaging even though the accept did not succeed.
      creditCheck?: ProviderLeadCreditCheckResult
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

  try {
    // Box the payload to prevent TypeScript from narrowing the `let` to `never`
    // after it is mutated inside the async $transaction callback.
    const notificationPayloadBox: { value: { leadId: string; providerId: string } | null } = { value: null }

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
          unlock: { select: { id: true, providerId: true } },
          jobRequest: {
            select: {
              status: true,
              expiresAt: true,
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
      if (
        lead.status === 'EXPIRED' ||
        lead.jobRequest.status === 'EXPIRED' ||
        (lead.expiresAt && lead.expiresAt <= new Date()) ||
        (lead.jobRequest.expiresAt && lead.jobRequest.expiresAt <= new Date())
      ) {
        return { ok: false as const, reason: 'LEAD_EXPIRED' as const }
      }
      if (lead.status === 'CREDIT_APPLIED' && !lead.unlock) {
        // Inconsistent state: credit was applied (status updated) but no LeadUnlock record
        // exists. This should not occur because both happen in the same transaction.
        // Routing to credit application could cause a double deduction - surface the error instead.
        console.error('[selected-provider-acceptance] inconsistent state: CREDIT_APPLIED with no LeadUnlock', {
          leadId: lead.id,
          providerId: params.providerId,
        })
        return { ok: false as const, reason: 'CREDIT_APPLICATION_FAILED' as const }
      }
      if (lead.status === 'CREDIT_APPLIED' || lead.unlock) {
        const creditApplication = await applyProviderCreditForAcceptedLeadInTransaction(tx, {
          leadId: lead.id,
          providerId: params.providerId,
          source: params.source,
          idempotencyKey: params.idempotencyKey,
          traceId: params.traceId,
        })
        const acceptedLock = await lockAcceptedLeadAfterCreditInTransaction(tx, {
          leadId: lead.id,
          providerId: params.providerId,
          source: params.source,
          traceId: params.traceId,
          currentCreditBalance: creditApplication.currentCreditBalance,
          paidCreditBalance: creditApplication.paidCreditBalance,
          promoCreditBalance: creditApplication.promoCreditBalance,
        })
        const { notificationPayload: lockPayload, ...acceptedLockPublic } = acceptedLock
        notificationPayloadBox.value = lockPayload ? { leadId: lockPayload.leadId, providerId: lockPayload.providerId } : null
        return {
          ok: true as const,
          leadId: lead.id,
          creditCheck: {
            ok: true as const,
            leadId: lead.id,
            providerId: params.providerId,
            result: 'SUFFICIENT_CREDITS' as const,
            requiredCredits: LEAD_UNLOCK_COST_CREDITS,
            currentCreditBalance: creditApplication.currentCreditBalance,
            paidCreditBalance: creditApplication.paidCreditBalance,
            promoCreditBalance: creditApplication.promoCreditBalance,
            leadStatus: 'PROVIDER_ACCEPTED' as const,
            providerMessage: creditApplication.providerMessage,
          },
          creditApplication,
          acceptedLock: acceptedLockPublic,
          currentCreditBalance: creditApplication.currentCreditBalance,
          alreadyAccepted: true,
          alreadyUnlocked: acceptedLockPublic.alreadyLocked,
          creditApplied: true,
          matchId: null,
          jobId: null,
          bookingId: null,
          creditTransactionId: creditApplication.creditTransactionId,
          notificationSent: false,
        }
      }
      if (lead.status === 'DECLINED') {
        return { ok: false as const, reason: 'LEAD_DECLINED' as const }
      }
      if (lead.status === 'ACCEPTED' || lead.status === 'ACCEPTED_LOCKED') {
        return { ok: false as const, reason: 'LEAD_ALREADY_ACCEPTED' as const }
      }
      if (lead.jobRequest.status !== 'PROVIDER_CONFIRMATION_PENDING') {
        return { ok: false as const, reason: 'REQUEST_NOT_AWAITING_CONFIRMATION' as const }
      }

      try {
        await assertIdentityVerifiedForCredits(params.providerId, tx)
      } catch (error) {
        if (error instanceof IdentityCreditGateError) {
          return { ok: false as const, reason: 'IDENTITY_NOT_VERIFIED' as const }
        }
        throw error
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
          const currentLead = await tx.lead.findUnique({
            where: { id: lead.id },
            select: { status: true },
          })
          if (currentLead?.status === 'DECLINED') {
            return { ok: false as const, reason: 'LEAD_DECLINED' as const }
          }
          if (
            currentLead?.status === 'PROVIDER_ACCEPTED' ||
            currentLead?.status === 'CREDIT_REQUIRED' ||
            currentLead?.status === 'CREDIT_APPLIED' ||
            currentLead?.status === 'ACCEPTED' ||
            currentLead?.status === 'ACCEPTED_LOCKED'
          ) {
            alreadyAccepted = true
          } else {
            return { ok: false as const, reason: 'DUPLICATE_ACCEPT_IGNORED' as const }
          }
        }

        if (!alreadyAccepted) {
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
        }
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

      if (!creditCheck.ok) {
        // SECURITY (66b2eee9): a failed credit check leaves the lead in
        // CREDIT_REQUIRED (a non-final, locked-pending state) with NO credit
        // spent. The outer function must therefore report failure, never
        // success — otherwise the request stays locked while callers believe
        // the lead was accepted. Map the underlying credit-check reason onto an
        // existing failure reason that callers already handle with the right
        // top-up / wallet messaging, and carry the full creditCheck detail.
        const failureReason =
          creditCheck.reason === 'INSUFFICIENT_CREDITS' ||
          creditCheck.reason === 'WALLET_MISSING' ||
          creditCheck.reason === 'CORRUPT_CREDIT_BALANCE' ||
          creditCheck.reason === 'WALLET_NOT_ACTIVE'
            ? ('INSUFFICIENT_CREDITS' as const)
            : ('CREDIT_REQUIRED' as const)
        return {
          ok: false as const,
          reason: failureReason,
          currentCreditBalance: creditCheck.currentCreditBalance,
          creditCheck,
        }
      }

      const creditApplication = await applyProviderCreditForAcceptedLeadInTransaction(tx, {
        leadId: lead.id,
        providerId: params.providerId,
        source: params.source,
        idempotencyKey: params.idempotencyKey,
        traceId: params.traceId,
      })
      const acceptedLock = await lockAcceptedLeadAfterCreditInTransaction(tx, {
        leadId: lead.id,
        providerId: params.providerId,
        source: params.source,
        traceId: params.traceId,
        currentCreditBalance: creditApplication.currentCreditBalance,
        paidCreditBalance: creditApplication.paidCreditBalance,
        promoCreditBalance: creditApplication.promoCreditBalance,
      })
      const { notificationPayload: lockPayload, ...acceptedLockPublic } = acceptedLock
      notificationPayloadBox.value = lockPayload ? { leadId: lockPayload.leadId, providerId: lockPayload.providerId } : null

      return {
        ok: true as const,
        leadId: lead.id,
        creditCheck,
        creditApplication,
        acceptedLock: acceptedLockPublic,
        currentCreditBalance: creditApplication.currentCreditBalance,
        alreadyAccepted,
        alreadyUnlocked: acceptedLockPublic.alreadyLocked,
        creditApplied: true,
        matchId: null,
        jobId: null,
        bookingId: null,
        creditTransactionId: creditApplication.creditTransactionId,
        notificationSent: false,
      }
    }, {
      maxWait: SELECTED_PROVIDER_ACCEPTANCE_TRANSACTION_MAX_WAIT_MS,
      timeout: SELECTED_PROVIDER_ACCEPTANCE_TRANSACTION_TIMEOUT_MS,
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

    // Tier 1 funnel observability — PROVIDER_ACCEPTED emit. Post-tx + only on
    // the first acceptance (alreadyAccepted retries are idempotency, not a new
    // acceptance event). Best-effort.
    // Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
    if (!result.alreadyAccepted) {
      recordWorkflowEvent({
        eventType: 'PROVIDER_ACCEPTED',
        actorType: 'provider',
        actorId: params.providerId,
        entityType: 'LEAD',
        entityId: params.leadId,
        source: params.source ?? 'api',
        metadata: {
          providerId: params.providerId,
          matchId: result.matchId ?? null,
          jobId: result.jobId ?? null,
          bookingId: result.bookingId ?? null,
          creditsCharged: result.creditCheck?.requiredCredits ?? null,
          creditTransactionId: result.creditTransactionId ?? null,
          path: 'qualified-shortlist',
        },
      }).catch(() => {})
    }

    const notificationPayload = notificationPayloadBox.value

    const notificationSent = notificationPayload
      ? await notifyAcceptedLeadLocked(notificationPayload)
      : false

    // Fire-and-forget: courtesy notification to non-selected INTERESTED providers
    if (notificationPayload) {
      notifyNonSelectedRfpProviders({ acceptedLeadId: notificationPayload.leadId, traceId: params.traceId })
        .catch((error) => {
          console.warn('[selected-provider-acceptance] rfp_not_selected_notify_error', {
            leadId: notificationPayload.leadId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }

    logProviderLeadAction({
      leadId: params.leadId,
      providerId: params.providerId,
      action: 'accept',
      result: result.acceptedLock?.alreadyLocked ? 'idempotent' : result.creditApplied ? 'accepted_locked' : result.alreadyAccepted ? 'idempotent' : 'accepted',
      source: params.source,
      traceId: params.traceId,
      // Success results always carry a passing credit check now; a failed
      // credit check returns the failure shape earlier (SECURITY 66b2eee9).
      reason: undefined,
    })

    return { ...result, notificationSent }
  } catch (error) {
    if (error instanceof ProviderCreditApplicationError) {
      if (error.code === 'INSUFFICIENT_CREDITS') {
        return { ok: false, reason: 'INSUFFICIENT_CREDITS', currentCreditBalance: error.currentCreditBalance }
      }
      if (error.code === 'CONCURRENT_DEDUCTION') {
        // Concurrent debit resolved the race; surface as a soft duplicate-accept signal
        // rather than propagating a throw that the caller cannot easily handle.
        return { ok: false, reason: 'DUPLICATE_ACCEPT_IGNORED' as const }
      }
      if (error.code === 'WALLET_MISSING' || error.code === 'WALLET_NOT_ACTIVE') {
        // Wallet disappeared or was suspended between credit check and application.
        // This is a data integrity issue - do not show "top up" message.
        return { ok: false, reason: 'CREDIT_APPLICATION_FAILED' }
      }
      if (error.code === 'LEAD_EXPIRED') {
        return { ok: false, reason: 'LEAD_EXPIRED' }
      }
      if (error.code === 'REQUEST_CANCELLED') {
        return { ok: false, reason: 'REQUEST_CANCELLED' }
      }
      if (error.code === 'PROVIDER_NOT_SELECTED') {
        return { ok: false, reason: 'PROVIDER_NOT_SELECTED' }
      }
      if (error.code === 'LEAD_NOT_ACCEPTED') {
        return { ok: false, reason: 'LEAD_NOT_PROVIDER_NOTIFIED' }
      }
    }
    if (error instanceof IdentityCreditGateError) {
      return { ok: false, reason: 'IDENTITY_NOT_VERIFIED' }
    }
    if (error instanceof AcceptedLeadLockError) {
      if (error.code === 'REQUEST_CANCELLED') {
        return { ok: false, reason: 'REQUEST_CANCELLED' }
      }
      if (error.code === 'LEAD_EXPIRED') {
        return { ok: false, reason: 'LEAD_EXPIRED' }
      }
      if (error.code === 'PROVIDER_NOT_SELECTED') {
        return { ok: false, reason: 'PROVIDER_NOT_SELECTED' }
      }
      if (error.code === 'LEAD_ALREADY_LOCKED') {
        return { ok: false, reason: 'LEAD_ALREADY_ACCEPTED' }
      }
      if (error.code === 'CREDIT_NOT_APPLIED' || error.code === 'CREDIT_TRANSACTION_MISSING') {
        return { ok: false, reason: 'CREDIT_APPLICATION_FAILED' }
      }
      if (error.code === 'ACCEPTED_LOCK_FAILED') {
        return { ok: false, reason: 'JOB_ASSIGNMENT_FAILED' }
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
    return { ok: false, reason: 'CREDIT_APPLICATION_FAILED' }
  }
}
