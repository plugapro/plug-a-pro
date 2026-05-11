import { Prisma, type LeadUnlock, type WalletLedgerEntry } from '@prisma/client'
import { db } from './db'
import { LEAD_UNLOCK_COST_CREDITS } from './lead-unlocks'
import {
  ProviderWalletError,
  debitCreditsForLeadUnlockInTransaction,
  type WalletMutationResult,
} from './provider-wallet'

const CREDIT_APPLICATION_REFERENCE_TYPE = 'selected_lead_credit_application'
const TEST_CREDIT_APPLICATION_REFERENCE_TYPE = 'test_selected_lead_credit_application'

type ProviderCreditApplicationErrorCode =
  | 'NOT_FOUND'
  | 'PROVIDER_NOT_SELECTED'
  | 'LEAD_NOT_ACCEPTED'
  | 'REQUEST_CANCELLED'
  | 'LEAD_EXPIRED'
  | 'LEAD_ALREADY_LOCKED'
  | 'WALLET_MISSING'
  | 'INSUFFICIENT_CREDITS'
  | 'WALLET_NOT_ACTIVE'
  | 'CORRUPT_CREDIT_BALANCE'
  | 'CONCURRENT_DEDUCTION'

export class ProviderCreditApplicationError extends Error {
  constructor(
    public readonly code: ProviderCreditApplicationErrorCode,
    message: string,
    public readonly currentCreditBalance?: number,
  ) {
    super(message)
    this.name = 'ProviderCreditApplicationError'
  }
}

export type ProviderCreditApplicationResult = {
  ok: true
  leadId: string
  providerId: string
  leadStatus: 'CREDIT_APPLIED'
  requiredCredits: number
  currentCreditBalance: number
  paidCreditBalance: number
  promoCreditBalance: number
  creditTransactionId: string | null
  leadUnlockId: string
  alreadyApplied: boolean
  providerMessage: string
}

type CreditApplicationTx = Prisma.TransactionClient

function creditBreakdown(ledgerEntries: WalletLedgerEntry[]) {
  return ledgerEntries.reduce(
    (breakdown, entry) => ({
      ...breakdown,
      [entry.creditType.toLowerCase()]: entry.amountCredits,
    }),
    {} as Record<string, number>,
  )
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function balanceFromLedgerEntries(
  ledgerEntries: WalletLedgerEntry[],
  fallback: { paidCreditBalance: number; promoCreditBalance: number },
) {
  const latest = ledgerEntries.at(-1)
  const paidCreditBalance = latest?.balanceAfterPaidCredits ?? fallback.paidCreditBalance
  const promoCreditBalance = latest?.balanceAfterPromoCredits ?? fallback.promoCreditBalance
  return {
    paidCreditBalance,
    promoCreditBalance,
    currentCreditBalance: paidCreditBalance + promoCreditBalance,
  }
}

function creditAppliedMessage(result: {
  requiredCredits: number
  currentCreditBalance: number
  alreadyApplied: boolean
}) {
  return [
    result.alreadyApplied ? 'Credit was already applied for this job.' : 'Credit applied.',
    '',
    `${result.requiredCredits} Plug A Pro provider credit${result.requiredCredits === 1 ? '' : 's'} deducted.`,
    `Available balance: ${result.currentCreditBalance} credits.`,
    'Customer direct contact details remain locked until the final accepted-lock step completes.',
  ].join('\n')
}

function logCreditApplication(params: {
  leadId: string
  providerId: string
  result: string
  source?: string
  traceId?: string
  creditTransactionId?: string | null
  reason?: string
  error?: unknown
}) {
  console.info('[provider-credit-application]', {
    leadId: params.leadId,
    providerId: params.providerId,
    action: 'credit_application',
    result: params.result,
    source: params.source ?? 'api',
    traceId: params.traceId ?? null,
    creditTransactionId: params.creditTransactionId ?? null,
    reason: params.reason ?? null,
    error: params.error instanceof Error ? params.error.message : params.error ? String(params.error) : null,
  })
}

function mapWalletError(error: unknown, currentCreditBalance?: number): never {
  if (error instanceof ProviderWalletError && error.code === 'INSUFFICIENT_FUNDS') {
    throw new ProviderCreditApplicationError(
      'INSUFFICIENT_CREDITS',
      'Provider wallet does not have enough credits.',
      currentCreditBalance,
    )
  }

  if (error instanceof ProviderWalletError && error.code === 'WALLET_NOT_ACTIVE') {
    throw new ProviderCreditApplicationError(
      'WALLET_NOT_ACTIVE',
      'Provider wallet is not active.',
      currentCreditBalance,
    )
  }

  if (error instanceof ProviderWalletError && error.code === 'CONCURRENT_MUTATION') {
    throw new ProviderCreditApplicationError(
      'CONCURRENT_DEDUCTION',
      'Provider wallet changed while applying credit.',
      currentCreditBalance,
    )
  }

  throw error
}

async function findExistingApplicationTransaction(
  tx: CreditApplicationTx,
  params: { leadId: string; providerId: string },
) {
  return tx.walletLedgerEntry.findFirst({
    where: {
      providerId: params.providerId,
      entryType: 'LEAD_UNLOCK_DEBIT',
      referenceType: { in: [CREDIT_APPLICATION_REFERENCE_TYPE, TEST_CREDIT_APPLICATION_REFERENCE_TYPE] },
      referenceId: params.leadId,
    },
    orderBy: { createdAt: 'desc' },
  })
}

async function buildAlreadyAppliedResult(
  tx: CreditApplicationTx,
  params: {
    leadId: string
    providerId: string
    leadUnlock: LeadUnlock
  },
): Promise<ProviderCreditApplicationResult> {
  const [wallet, ledgerEntry] = await Promise.all([
    tx.providerWallet.findUnique({
      where: { providerId: params.providerId },
      select: { paidCreditBalance: true, promoCreditBalance: true },
    }),
    findExistingApplicationTransaction(tx, params),
  ])
  const paidCreditBalance = wallet?.paidCreditBalance ?? ledgerEntry?.balanceAfterPaidCredits ?? 0
  const promoCreditBalance = wallet?.promoCreditBalance ?? ledgerEntry?.balanceAfterPromoCredits ?? 0

  return {
    ok: true,
    leadId: params.leadId,
    providerId: params.providerId,
    leadStatus: 'CREDIT_APPLIED',
    requiredCredits: LEAD_UNLOCK_COST_CREDITS,
    currentCreditBalance: paidCreditBalance + promoCreditBalance,
    paidCreditBalance,
    promoCreditBalance,
    creditTransactionId: ledgerEntry?.id ?? null,
    leadUnlockId: params.leadUnlock.id,
    alreadyApplied: true,
    providerMessage: creditAppliedMessage({
      requiredCredits: LEAD_UNLOCK_COST_CREDITS,
      currentCreditBalance: paidCreditBalance + promoCreditBalance,
      alreadyApplied: true,
    }),
  }
}

export async function applyProviderCreditForAcceptedLead(params: {
  leadId: string
  providerId: string
  source?: 'whatsapp' | 'pwa' | 'api'
  idempotencyKey?: string
  traceId?: string
}): Promise<ProviderCreditApplicationResult> {
  try {
    return await db.$transaction((tx) => applyProviderCreditForAcceptedLeadInTransaction(tx, params))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return db.$transaction((tx) => replayExistingCreditApplication(tx, params))
    }
    throw error
  }
}

export async function applyProviderCreditForAcceptedLeadInTransaction(
  tx: CreditApplicationTx,
  params: {
    leadId: string
    providerId: string
    source?: 'whatsapp' | 'pwa' | 'api'
    idempotencyKey?: string
    traceId?: string
  },
): Promise<ProviderCreditApplicationResult> {
  logCreditApplication({
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
      provider: {
        select: {
          id: true,
          active: true,
          verified: true,
          status: true,
          isTestUser: true,
        },
      },
      jobRequest: {
        select: {
          id: true,
          status: true,
          selectedProviderId: true,
          selectedLeadInviteId: true,
          isTestRequest: true,
          cohortName: true,
          match: { select: { id: true } },
        },
      },
    },
  })

  if (!lead) {
    logCreditApplication({ leadId: params.leadId, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'NOT_FOUND' })
    throw new ProviderCreditApplicationError('NOT_FOUND', 'Lead not found.')
  }

  if (
    lead.providerId !== params.providerId ||
    lead.jobRequest.selectedProviderId !== params.providerId ||
    lead.jobRequest.selectedLeadInviteId !== lead.id
  ) {
    logCreditApplication({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'PROVIDER_NOT_SELECTED' })
    throw new ProviderCreditApplicationError('PROVIDER_NOT_SELECTED', 'This lead belongs to another provider.')
  }

  if (lead.unlock) {
    if (lead.unlock.providerId !== params.providerId) {
      throw new ProviderCreditApplicationError('PROVIDER_NOT_SELECTED', 'This lead belongs to another provider.')
    }

    if (lead.status !== 'CREDIT_APPLIED') {
      await tx.lead.updateMany({
        where: { id: lead.id, status: { in: ['PROVIDER_ACCEPTED', 'CREDIT_REQUIRED'] } },
        data: { status: 'CREDIT_APPLIED', respondedAt: new Date() },
      })
    }

    const result = await buildAlreadyAppliedResult(tx, {
      leadId: lead.id,
      providerId: params.providerId,
      leadUnlock: lead.unlock,
    })
    logCreditApplication({
      leadId: lead.id,
      providerId: params.providerId,
      result: 'idempotent',
      source: params.source,
      traceId: params.traceId,
      creditTransactionId: result.creditTransactionId,
    })
    return result
  }

  if (lead.jobRequest.match) {
    logCreditApplication({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'LEAD_ALREADY_LOCKED' })
    throw new ProviderCreditApplicationError('LEAD_ALREADY_LOCKED', 'This request is already locked.')
  }

  if (lead.status === 'CANCELLED' || lead.cancelledAt || lead.jobRequest.status === 'CANCELLED') {
    logCreditApplication({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'REQUEST_CANCELLED' })
    throw new ProviderCreditApplicationError('REQUEST_CANCELLED', 'This request was cancelled.')
  }

  if (lead.status === 'EXPIRED' || lead.jobRequest.status === 'EXPIRED' || (lead.expiresAt && lead.expiresAt <= new Date())) {
    logCreditApplication({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'LEAD_EXPIRED' })
    throw new ProviderCreditApplicationError('LEAD_EXPIRED', 'This lead has expired.')
  }

  if (lead.status !== 'PROVIDER_ACCEPTED') {
    logCreditApplication({ leadId: lead.id, providerId: params.providerId, result: 'blocked', source: params.source, traceId: params.traceId, reason: 'LEAD_NOT_ACCEPTED' })
    throw new ProviderCreditApplicationError('LEAD_NOT_ACCEPTED', 'This lead is not ready for credit application.')
  }

  const wallet = await tx.providerWallet.findUnique({
    where: { providerId: params.providerId },
    select: {
      id: true,
      paidCreditBalance: true,
      promoCreditBalance: true,
      status: true,
    },
  })
  const currentCreditBalance = (wallet?.paidCreditBalance ?? 0) + (wallet?.promoCreditBalance ?? 0)

  if (!wallet) {
    // Belt-and-suspenders: credit check should have caught this in the same tx.
    // Treat as a data integrity failure — caller should surface as CREDIT_APPLICATION_FAILED.
    throw new ProviderCreditApplicationError(
      'WALLET_MISSING',
      'Provider wallet does not exist.',
      0,
    )
  }
  if (wallet.status !== 'ACTIVE') {
    throw new ProviderCreditApplicationError(
      'WALLET_NOT_ACTIVE',
      'Provider wallet is not active.',
      currentCreditBalance,
    )
  }

  if (wallet.paidCreditBalance < 0 || wallet.promoCreditBalance < 0 || currentCreditBalance < 0) {
    throw new ProviderCreditApplicationError(
      'CORRUPT_CREDIT_BALANCE',
      'Provider wallet has a corrupt credit balance.',
      Math.max(0, currentCreditBalance),
    )
  }

  if (currentCreditBalance < LEAD_UNLOCK_COST_CREDITS) {
    throw new ProviderCreditApplicationError(
      'INSUFFICIENT_CREDITS',
      'Provider wallet does not have enough credits.',
      currentCreditBalance,
    )
  }

  const isTestApplication = lead.jobRequest.isTestRequest || lead.provider.isTestUser
  const referenceType = isTestApplication
    ? TEST_CREDIT_APPLICATION_REFERENCE_TYPE
    : CREDIT_APPLICATION_REFERENCE_TYPE
  const traceId = params.traceId ?? `credit_apply_${lead.id}_${Date.now().toString(36)}`

  // This marker is created before the wallet debit inside the same database
  // transaction. Its unique leadId constraint prevents double-clicks and
  // duplicate WhatsApp webhooks from creating two successful debits for one
  // accepted lead; any later failure rolls the marker and debit back together.
  const unlock = await tx.leadUnlock.create({
    data: {
      leadId: lead.id,
      providerId: params.providerId,
      matchId: null,
      creditsCharged: LEAD_UNLOCK_COST_CREDITS,
      creditTypeBreakdown: {},
      isTestUnlock: isTestApplication,
      cohortName: lead.jobRequest.cohortName,
      status: 'UNLOCKED',
    },
  })

  let debitResult: WalletMutationResult
  try {
    debitResult = await debitCreditsForLeadUnlockInTransaction(
      tx,
      params.providerId,
      LEAD_UNLOCK_COST_CREDITS,
      {
        referenceType,
        referenceId: lead.id,
        description: `${isTestApplication ? 'Test selected lead credit application' : 'Selected lead credit application'} ${lead.id.slice(-8).toUpperCase()}`,
        idempotencyKey: params.idempotencyKey ?? `${referenceType}:${params.providerId}:${lead.id}`,
        traceId,
        source: params.source ?? 'api',
        metadata: {
          leadId: lead.id,
          leadRef: lead.id.slice(-8).toUpperCase(),
          jobRequestId: lead.jobRequestId,
          leadUnlockId: unlock.id,
          action: 'selected_provider_credit_application',
          source: params.source ?? 'api',
          traceId,
          ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
          ...(lead.jobRequest.cohortName ? { testCohort: lead.jobRequest.cohortName } : {}),
        },
        createdBy: params.providerId,
        isTestTransaction: isTestApplication,
        cohortName: lead.jobRequest.cohortName,
      },
    )
  } catch (error) {
    mapWalletError(error, currentCreditBalance)
  }

  const updatedUnlock = await tx.leadUnlock.update({
    where: { id: unlock.id },
    data: {
      creditTypeBreakdown: toJson(creditBreakdown(debitResult.ledgerEntries)),
    },
  })

  const leadUpdated = await tx.lead.updateMany({
    where: { id: lead.id, status: 'PROVIDER_ACCEPTED' },
    data: { status: 'CREDIT_APPLIED', respondedAt: new Date() },
  })
  if (leadUpdated.count !== 1) {
    throw new ProviderCreditApplicationError(
      'CONCURRENT_DEDUCTION',
      'Lead changed while applying provider credit.',
      currentCreditBalance,
    )
  }

  const balance = balanceFromLedgerEntries(debitResult.ledgerEntries, wallet)
  const creditTransactionId = debitResult.ledgerEntries.at(-1)?.id ?? null

  await tx.auditLog.create({
    data: {
      actorId: params.providerId,
      actorRole: 'provider',
      action: 'lead.provider_credit_applied',
      entityType: 'Lead',
      entityId: lead.id,
      before: { status: 'PROVIDER_ACCEPTED' } as Prisma.InputJsonValue,
      after: {
        status: 'CREDIT_APPLIED',
        leadUnlockId: updatedUnlock.id,
        creditTransactionId,
        requiredCredits: LEAD_UNLOCK_COST_CREDITS,
        currentCreditBalance: balance.currentCreditBalance,
        source: params.source ?? 'api',
      } as Prisma.InputJsonValue,
    },
  })

  logCreditApplication({
    leadId: lead.id,
    providerId: params.providerId,
    result: 'success',
    source: params.source,
    traceId,
    creditTransactionId,
  })

  return {
    ok: true,
    leadId: lead.id,
    providerId: params.providerId,
    leadStatus: 'CREDIT_APPLIED',
    requiredCredits: LEAD_UNLOCK_COST_CREDITS,
    currentCreditBalance: balance.currentCreditBalance,
    paidCreditBalance: balance.paidCreditBalance,
    promoCreditBalance: balance.promoCreditBalance,
    creditTransactionId,
    leadUnlockId: updatedUnlock.id,
    alreadyApplied: false,
    providerMessage: creditAppliedMessage({
      requiredCredits: LEAD_UNLOCK_COST_CREDITS,
      currentCreditBalance: balance.currentCreditBalance,
      alreadyApplied: false,
    }),
  }
}

async function replayExistingCreditApplication(
  tx: CreditApplicationTx,
  params: {
    leadId: string
    providerId: string
    source?: 'whatsapp' | 'pwa' | 'api'
    traceId?: string
  },
) {
  const lead = await tx.lead.findUnique({
    where: { id: params.leadId },
    select: { id: true, providerId: true, unlock: true },
  })

  if (!lead?.unlock || lead.providerId !== params.providerId || lead.unlock.providerId !== params.providerId) {
    throw new ProviderCreditApplicationError(
      'CONCURRENT_DEDUCTION',
      'Credit application was retried while another request was still committing.',
    )
  }

  const result = await buildAlreadyAppliedResult(tx, {
    leadId: lead.id,
    providerId: params.providerId,
    leadUnlock: lead.unlock,
  })

  logCreditApplication({
    leadId: lead.id,
    providerId: params.providerId,
    result: 'idempotent_replay',
    source: params.source,
    traceId: params.traceId,
    creditTransactionId: result.creditTransactionId,
  })

  return result
}
