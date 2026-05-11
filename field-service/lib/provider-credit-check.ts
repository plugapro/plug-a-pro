import { Prisma } from '@prisma/client'
import { db } from './db'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import { buildInsufficientCreditsMessage, creditCountLabel } from './provider-credit-copy'

type CreditCheckTx = Prisma.TransactionClient

export type ProviderLeadCreditCheckResult =
  | {
      ok: true
      leadId: string
      providerId: string
      result: 'SUFFICIENT_CREDITS'
      requiredCredits: number
      currentCreditBalance: number
      paidCreditBalance: number
      promoCreditBalance: number
      leadStatus: 'PROVIDER_ACCEPTED'
      providerMessage: string
    }
  | {
      ok: false
      leadId?: string
      providerId: string
      reason:
        | 'NOT_FOUND'
        | 'PROVIDER_NOT_SELECTED'
        | 'LEAD_NOT_ACCEPTED'
        | 'REQUEST_CANCELLED'
        | 'LEAD_EXPIRED'
        | 'LEAD_ALREADY_LOCKED'
        | 'WALLET_MISSING'
        | 'WALLET_NOT_ACTIVE'
        | 'INSUFFICIENT_CREDITS'
        | 'CORRUPT_CREDIT_BALANCE'
      requiredCredits?: number
      currentCreditBalance?: number
      paidCreditBalance?: number
      promoCreditBalance?: number
      leadStatus?: string
      providerMessage: string
    }

const CREDIT_CHECK_STATUSES = ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] as const

function logCreditCheck(params: {
  leadId: string
  providerId: string
  result: string
  source?: string
  traceId?: string
  reason?: string
}) {
  console.info('[provider-credit-check]', {
    leadId: params.leadId,
    providerId: params.providerId,
    action: 'credit_check',
    result: params.result,
    source: params.source ?? 'api',
    traceId: params.traceId ?? null,
    reason: params.reason ?? null,
  })
}

function creditCheckPassedMessage(requiredCredits: number) {
  return [
    'Accepted.',
    '',
    `Credit check passed. ${creditCountLabel(requiredCredits)} will be applied in the next step.`,
    'No credit has been deducted yet.',
    'Customer direct contact details are still locked.',
  ].join('\n')
}

function blockedMessage(reason: string) {
  switch (reason) {
    case 'NOT_FOUND':
      return 'This lead could not be found.'
    case 'PROVIDER_NOT_SELECTED':
      return 'This job was offered to a different provider.'
    case 'LEAD_NOT_ACCEPTED':
      return 'This lead has not been accepted yet.'
    case 'REQUEST_CANCELLED':
      return 'This request was cancelled.'
    case 'LEAD_EXPIRED':
      return 'This lead has expired.'
    case 'LEAD_ALREADY_LOCKED':
      return 'This lead is already locked.'
    case 'WALLET_NOT_ACTIVE':
      return 'Your provider wallet is not active. Please contact support before continuing.'
    default:
      return 'Credit check could not be completed.'
  }
}

async function writeAudit(
  tx: CreditCheckTx,
  params: {
    leadId: string
    providerId: string
    action: string
    beforeStatus?: string | null
    afterStatus?: string | null
    requiredCredits?: number
    currentCreditBalance?: number
    source?: string
  },
) {
  await tx.auditLog.create({
    data: {
      actorId: params.providerId,
      actorRole: 'provider',
      action: params.action,
      entityType: 'Lead',
      entityId: params.leadId,
      before: params.beforeStatus ? ({ status: params.beforeStatus } as Prisma.InputJsonValue) : undefined,
      after: {
        status: params.afterStatus ?? null,
        requiredCredits: params.requiredCredits ?? null,
        currentCreditBalance: params.currentCreditBalance ?? null,
        source: params.source ?? 'api',
      } as Prisma.InputJsonValue,
    },
  })
}

export async function checkProviderLeadCreditBalance(params: {
  leadId: string
  providerId: string
  source?: 'whatsapp' | 'pwa' | 'api'
  traceId?: string
}): Promise<ProviderLeadCreditCheckResult> {
  return db.$transaction((tx) => checkProviderLeadCreditBalanceInTransaction(tx, params))
}

export async function checkProviderLeadCreditBalanceInTransaction(
  tx: CreditCheckTx,
  params: {
    leadId: string
    providerId: string
    source?: 'whatsapp' | 'pwa' | 'api'
    traceId?: string
  },
): Promise<ProviderLeadCreditCheckResult> {
  logCreditCheck({
    leadId: params.leadId,
    providerId: params.providerId,
    result: 'attempt',
    source: params.source,
    traceId: params.traceId,
  })

  const lead = await tx.lead.findUnique({
    where: { id: params.leadId },
    select: {
      id: true,
      providerId: true,
      status: true,
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

  if (!lead) {
    logCreditCheck({ leadId: params.leadId, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'NOT_FOUND' })
    return { ok: false, providerId: params.providerId, reason: 'NOT_FOUND', providerMessage: blockedMessage('NOT_FOUND') }
  }

  if (
    lead.providerId !== params.providerId ||
    lead.jobRequest.selectedProviderId !== params.providerId ||
    lead.jobRequest.selectedLeadInviteId !== lead.id
  ) {
    logCreditCheck({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'PROVIDER_NOT_SELECTED' })
    return {
      ok: false,
      leadId: lead.id,
      providerId: params.providerId,
      reason: 'PROVIDER_NOT_SELECTED',
      leadStatus: lead.status,
      providerMessage: blockedMessage('PROVIDER_NOT_SELECTED'),
    }
  }

  if (lead.unlock || lead.status === 'ACCEPTED') {
    logCreditCheck({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'LEAD_ALREADY_LOCKED' })
    return {
      ok: false,
      leadId: lead.id,
      providerId: params.providerId,
      reason: 'LEAD_ALREADY_LOCKED',
      leadStatus: lead.status,
      providerMessage: blockedMessage('LEAD_ALREADY_LOCKED'),
    }
  }

  if (lead.status === 'CANCELLED' || lead.cancelledAt || lead.jobRequest.status === 'CANCELLED') {
    logCreditCheck({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'REQUEST_CANCELLED' })
    return {
      ok: false,
      leadId: lead.id,
      providerId: params.providerId,
      reason: 'REQUEST_CANCELLED',
      leadStatus: lead.status,
      providerMessage: blockedMessage('REQUEST_CANCELLED'),
    }
  }

  if (lead.status === 'EXPIRED' || (lead.expiresAt && lead.expiresAt <= new Date())) {
    logCreditCheck({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'LEAD_EXPIRED' })
    return {
      ok: false,
      leadId: lead.id,
      providerId: params.providerId,
      reason: 'LEAD_EXPIRED',
      leadStatus: lead.status,
      providerMessage: blockedMessage('LEAD_EXPIRED'),
    }
  }

  if (!CREDIT_CHECK_STATUSES.includes(lead.status as (typeof CREDIT_CHECK_STATUSES)[number])) {
    logCreditCheck({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'LEAD_NOT_ACCEPTED' })
    return {
      ok: false,
      leadId: lead.id,
      providerId: params.providerId,
      reason: 'LEAD_NOT_ACCEPTED',
      leadStatus: lead.status,
      providerMessage: blockedMessage('LEAD_NOT_ACCEPTED'),
    }
  }

  const requiredCredits = LEAD_UNLOCK_COST_CREDITS
  const wallet = await tx.providerWallet.findUnique({
    where: { providerId: params.providerId },
    select: {
      paidCreditBalance: true,
      promoCreditBalance: true,
      status: true,
    },
  })

  const applyCreditRequired = async (
    reason: 'WALLET_MISSING' | 'WALLET_NOT_ACTIVE' | 'INSUFFICIENT_CREDITS' | 'CORRUPT_CREDIT_BALANCE',
    balances: { currentCreditBalance: number; paidCreditBalance: number; promoCreditBalance: number },
  ): Promise<ProviderLeadCreditCheckResult> => {
    const updated = await tx.lead.updateMany({
      where: {
        id: lead.id,
        status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] },
      },
      data: { status: 'CREDIT_REQUIRED' },
    })

    if (updated.count > 0 && lead.status !== 'CREDIT_REQUIRED') {
      await writeAudit(tx, {
        leadId: lead.id,
        providerId: params.providerId,
        action: 'lead.provider_credit_required',
        beforeStatus: lead.status,
        afterStatus: 'CREDIT_REQUIRED',
        requiredCredits,
        currentCreditBalance: balances.currentCreditBalance,
        source: params.source,
      })
    }

    logCreditCheck({
      leadId: lead.id,
      providerId: params.providerId,
      result: 'credit_required',
      source: params.source,
      traceId: params.traceId,
      reason,
    })

    return {
      ok: false,
      leadId: lead.id,
      providerId: params.providerId,
      reason,
      requiredCredits,
      currentCreditBalance: balances.currentCreditBalance,
      paidCreditBalance: balances.paidCreditBalance,
      promoCreditBalance: balances.promoCreditBalance,
      leadStatus: 'CREDIT_REQUIRED',
      providerMessage:
        reason === 'WALLET_NOT_ACTIVE'
          ? blockedMessage('WALLET_NOT_ACTIVE')
          : buildInsufficientCreditsMessage({
              availableCredits: balances.currentCreditBalance,
              creditsRequired: requiredCredits,
            }),
    }
  }

  if (!wallet) {
    return applyCreditRequired('WALLET_MISSING', {
      currentCreditBalance: 0,
      paidCreditBalance: 0,
      promoCreditBalance: 0,
    })
  }

  if (wallet.status !== 'ACTIVE') {
    return applyCreditRequired('WALLET_NOT_ACTIVE', {
      currentCreditBalance: Math.max(0, wallet.paidCreditBalance + wallet.promoCreditBalance),
      paidCreditBalance: wallet.paidCreditBalance,
      promoCreditBalance: wallet.promoCreditBalance,
    })
  }

  const balanceIsCorrupt =
    wallet.paidCreditBalance < 0 ||
    wallet.promoCreditBalance < 0 ||
    wallet.paidCreditBalance + wallet.promoCreditBalance < 0
  const currentCreditBalance = Math.max(0, wallet.paidCreditBalance + wallet.promoCreditBalance)
  if (balanceIsCorrupt) {
    return applyCreditRequired('CORRUPT_CREDIT_BALANCE', {
      currentCreditBalance,
      paidCreditBalance: wallet.paidCreditBalance,
      promoCreditBalance: wallet.promoCreditBalance,
    })
  }

  if (currentCreditBalance < requiredCredits) {
    return applyCreditRequired('INSUFFICIENT_CREDITS', {
      currentCreditBalance,
      paidCreditBalance: wallet.paidCreditBalance,
      promoCreditBalance: wallet.promoCreditBalance,
    })
  }

  if (lead.status === 'CREDIT_REQUIRED') {
    await tx.lead.updateMany({
      where: { id: lead.id, status: 'CREDIT_REQUIRED' },
      data: { status: 'PROVIDER_ACCEPTED' },
    })
  }

  await writeAudit(tx, {
    leadId: lead.id,
    providerId: params.providerId,
    action: 'lead.provider_credit_check_passed',
    beforeStatus: lead.status,
    afterStatus: 'PROVIDER_ACCEPTED',
    requiredCredits,
    currentCreditBalance,
    source: params.source,
  })

  logCreditCheck({
    leadId: lead.id,
    providerId: params.providerId,
    result: 'sufficient',
    source: params.source,
    traceId: params.traceId,
  })

  return {
    ok: true,
    leadId: lead.id,
    providerId: params.providerId,
    result: 'SUFFICIENT_CREDITS',
    requiredCredits,
    currentCreditBalance,
    paidCreditBalance: wallet.paidCreditBalance,
    promoCreditBalance: wallet.promoCreditBalance,
    leadStatus: 'PROVIDER_ACCEPTED',
    providerMessage: creditCheckPassedMessage(requiredCredits),
  }
}
