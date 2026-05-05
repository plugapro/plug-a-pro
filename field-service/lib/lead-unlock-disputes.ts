import {
  Prisma,
  type LeadUnlock,
  type LeadUnlockDispute,
  type LeadUnlockDisputeReason,
  type ProviderWallet,
  type WalletCreditType,
  type WalletLedgerEntry,
} from '@prisma/client'
import { db } from './db'
import { refundCreditsInTransaction } from './provider-wallet'

type LeadUnlockDisputeErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_STATUS'
  | 'ALREADY_DISPUTED'
  | 'ALREADY_RESOLVED'
  | 'ALREADY_REFUNDED'
  | 'INVALID_REASON'

export class LeadUnlockDisputeError extends Error {
  constructor(
    public readonly code: LeadUnlockDisputeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'LeadUnlockDisputeError'
  }
}

export type LeadUnlockDisputeResult = {
  unlock: LeadUnlock
  dispute: LeadUnlockDispute
}

export type ResolveLeadUnlockDisputeResult = LeadUnlockDisputeResult & {
  wallet: ProviderWallet | null
  ledgerEntries: WalletLedgerEntry[]
}

type LeadUnlockDisputeTx = Prisma.TransactionClient

export const REFUNDABLE_LEAD_UNLOCK_DISPUTE_REASONS = [
  'INVALID_CUSTOMER_NUMBER',
  'DUPLICATE_LEAD',
  'WRONG_CATEGORY',
  'WRONG_LOCATION',
  'CUSTOMER_DID_NOT_REQUEST',
  'CANCELLED_BEFORE_UNLOCK',
] satisfies LeadUnlockDisputeReason[]

export const LEAD_UNLOCK_DISPUTE_REASON_LABELS: Record<LeadUnlockDisputeReason, string> = {
  INVALID_CUSTOMER_NUMBER: 'Customer number is invalid',
  DUPLICATE_LEAD: 'Duplicate lead for this provider',
  WRONG_CATEGORY: 'Job category was materially wrong',
  WRONG_LOCATION: 'Location was materially wrong',
  CUSTOMER_DID_NOT_REQUEST: 'Customer says they never requested this service',
  CANCELLED_BEFORE_UNLOCK: 'Lead was cancelled or closed before unlock',
}

function assertRefundableReason(reason: LeadUnlockDisputeReason) {
  if (!REFUNDABLE_LEAD_UNLOCK_DISPUTE_REASONS.includes(reason)) {
    throw new LeadUnlockDisputeError(
      'INVALID_REASON',
      'This dispute reason is not eligible for a credit refund.',
    )
  }
}

function cleanNotes(notes?: string | null) {
  const value = notes?.trim()
  return value ? value.slice(0, 1_000) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBreakdownKey(key: string): WalletCreditType | null {
  if (key.toUpperCase() === 'PAID') return 'PAID'
  if (key.toUpperCase() === 'PROMO') return 'PROMO'
  return null
}

function breakdownFromJson(value: Prisma.JsonValue): Partial<Record<WalletCreditType, number>> {
  if (!isRecord(value)) return {}

  return Object.entries(value).reduce((breakdown, [key, amount]) => {
    const creditType = normalizeBreakdownKey(key)
    if (
      !creditType ||
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return breakdown
    }
    return {
      ...breakdown,
      [creditType]: (breakdown[creditType] ?? 0) + amount,
    }
  }, {} as Partial<Record<WalletCreditType, number>>)
}

function breakdownFromLedgerEntries(
  ledgerEntries: Array<Pick<WalletLedgerEntry, 'creditType' | 'amountCredits'>>,
) {
  return ledgerEntries.reduce((breakdown, entry) => ({
    ...breakdown,
    [entry.creditType]: (breakdown[entry.creditType] ?? 0) + entry.amountCredits,
  }), {} as Partial<Record<WalletCreditType, number>>)
}

function normalizeRefundBreakdown(
  unlock: Pick<LeadUnlock, 'creditsCharged' | 'creditTypeBreakdown'>,
  debitEntries: Array<Pick<WalletLedgerEntry, 'creditType' | 'amountCredits'>>,
) {
  const fromLedger = breakdownFromLedgerEntries(debitEntries)
  const source = Object.values(fromLedger).some((amount) => (amount ?? 0) > 0)
    ? fromLedger
    : breakdownFromJson(unlock.creditTypeBreakdown)

  const total = (source.PAID ?? 0) + (source.PROMO ?? 0)
  if (total > 0) return source

  // Legacy fallback: if no original debit split exists, refund as promo credit
  // to avoid creating cash-convertible value without accounting evidence.
  return { PROMO: unlock.creditsCharged }
}

function refundReasonText(reason: LeadUnlockDisputeReason) {
  return LEAD_UNLOCK_DISPUTE_REASON_LABELS[reason]
}

export async function disputeLeadUnlockForProvider(
  leadId: string,
  providerId: string,
  reason: LeadUnlockDisputeReason,
  notes?: string | null,
): Promise<LeadUnlockDisputeResult> {
  assertRefundableReason(reason)

  return db.$transaction(async (tx) => {
    const unlock = await tx.leadUnlock.findUnique({
      where: { leadId },
      include: { dispute: true },
    })

    if (!unlock) {
      throw new LeadUnlockDisputeError('NOT_FOUND', 'Lead unlock not found.')
    }
    if (unlock.providerId !== providerId) {
      throw new LeadUnlockDisputeError('FORBIDDEN', 'This lead unlock belongs to another provider.')
    }
    if (unlock.status === 'REFUNDED' || unlock.refundedAt) {
      throw new LeadUnlockDisputeError('ALREADY_REFUNDED', 'This lead unlock has already been refunded.')
    }
    if (unlock.status === 'REVERSED') {
      throw new LeadUnlockDisputeError('INVALID_STATUS', 'This lead unlock has been reversed.')
    }
    if (unlock.dispute) {
      if (unlock.dispute.status === 'OPEN') {
        return {
          unlock,
          dispute: unlock.dispute,
        }
      }
      throw new LeadUnlockDisputeError(
        'ALREADY_RESOLVED',
        'This lead unlock dispute has already been resolved.',
      )
    }
    if (unlock.status !== 'UNLOCKED') {
      throw new LeadUnlockDisputeError(
        'INVALID_STATUS',
        `Cannot dispute a ${unlock.status.toLowerCase()} lead unlock.`,
      )
    }

    const now = new Date()
    const dispute = await tx.leadUnlockDispute.create({
      data: {
        leadUnlockId: unlock.id,
        providerId,
        reason,
        notes: cleanNotes(notes),
      },
    })

    const updatedUnlock = await tx.leadUnlock.update({
      where: { id: unlock.id },
      data: {
        status: 'DISPUTED',
        disputeReason: reason,
        disputeNotes: cleanNotes(notes),
        disputedAt: now,
      },
    })

    return {
      unlock: updatedUnlock,
      dispute,
    }
  })
}

export async function approveLeadUnlockDispute(
  disputeId: string,
  adminUserId: string,
  adminNotes?: string | null,
): Promise<ResolveLeadUnlockDisputeResult> {
  return db.$transaction((tx) => (
    approveLeadUnlockDisputeInTransaction(tx, disputeId, adminUserId, adminNotes)
  ))
}

export async function approveLeadUnlockDisputeInTransaction(
  tx: LeadUnlockDisputeTx,
  disputeId: string,
  adminUserId: string,
  adminNotes?: string | null,
): Promise<ResolveLeadUnlockDisputeResult> {
  const dispute = await tx.leadUnlockDispute.findUnique({
    where: { id: disputeId },
    include: { leadUnlock: true },
  })

  if (!dispute) {
    throw new LeadUnlockDisputeError('NOT_FOUND', 'Lead unlock dispute not found.')
  }
  if (dispute.status !== 'OPEN' || dispute.resolvedAt) {
    throw new LeadUnlockDisputeError('ALREADY_RESOLVED', 'This dispute has already been resolved.')
  }
  if (dispute.leadUnlock.status === 'REFUNDED' || dispute.leadUnlock.refundedAt) {
    throw new LeadUnlockDisputeError('ALREADY_REFUNDED', 'This lead unlock has already been refunded.')
  }
  if (dispute.leadUnlock.status !== 'DISPUTED') {
    throw new LeadUnlockDisputeError(
      'INVALID_STATUS',
      `Cannot refund a ${dispute.leadUnlock.status.toLowerCase()} lead unlock.`,
    )
  }

  const now = new Date()

  // Status transition happens before crediting. The predicate prevents a second
  // admin action from refunding the same unlock if two approvals race.
  const unlockUpdate = await tx.leadUnlock.updateMany({
    where: {
      id: dispute.leadUnlockId,
      status: 'DISPUTED',
      refundedAt: null,
    },
    data: {
      status: 'REFUNDED',
      refundedAt: now,
      refundReason: refundReasonText(dispute.reason),
      resolvedAt: now,
      resolvedBy: adminUserId,
    },
  })

  if (unlockUpdate.count !== 1) {
    throw new LeadUnlockDisputeError('ALREADY_REFUNDED', 'This lead unlock has already been refunded.')
  }

  const originalDebitEntries = await tx.walletLedgerEntry.findMany({
    where: {
      referenceType: 'lead_unlock',
      referenceId: dispute.leadUnlockId,
      entryType: 'LEAD_UNLOCK_DEBIT',
    },
  })

  const refundBreakdown = normalizeRefundBreakdown(dispute.leadUnlock, originalDebitEntries)
  const ledgerEntries: WalletLedgerEntry[] = []
  let wallet: ProviderWallet | null = null

  for (const creditType of ['PROMO', 'PAID'] as const) {
    const amountCredits = refundBreakdown[creditType] ?? 0
    if (amountCredits <= 0) continue

    const result = await refundCreditsInTransaction(
      tx,
      dispute.providerId,
      amountCredits,
      creditType,
      {
        referenceType: 'lead_unlock_dispute',
        referenceId: dispute.id,
        description: `Lead unlock refund: ${refundReasonText(dispute.reason)}`,
        metadata: {
          leadUnlockId: dispute.leadUnlockId,
          reason: dispute.reason,
          originalDebitReferenceType: 'lead_unlock',
          originalDebitReferenceId: dispute.leadUnlockId,
        },
        createdBy: adminUserId,
      },
    )

    wallet = result.wallet
    ledgerEntries.push(...result.ledgerEntries)
  }

  const updatedDispute = await tx.leadUnlockDispute.update({
    where: { id: dispute.id },
    data: {
      status: 'APPROVED',
      resolvedAt: now,
      resolvedBy: adminUserId,
      adminNotes: cleanNotes(adminNotes),
    },
  })

  const updatedUnlock = await tx.leadUnlock.findUniqueOrThrow({
    where: { id: dispute.leadUnlockId },
  })

  return {
    unlock: updatedUnlock,
    dispute: updatedDispute,
    wallet,
    ledgerEntries,
  }
}

export async function rejectLeadUnlockDispute(
  disputeId: string,
  adminUserId: string,
  adminNotes: string,
): Promise<ResolveLeadUnlockDisputeResult> {
  return db.$transaction((tx) => (
    rejectLeadUnlockDisputeInTransaction(tx, disputeId, adminUserId, adminNotes)
  ))
}

export async function rejectLeadUnlockDisputeInTransaction(
  tx: LeadUnlockDisputeTx,
  disputeId: string,
  adminUserId: string,
  adminNotes: string,
): Promise<ResolveLeadUnlockDisputeResult> {
  const dispute = await tx.leadUnlockDispute.findUnique({
    where: { id: disputeId },
    include: { leadUnlock: true },
  })

  if (!dispute) {
    throw new LeadUnlockDisputeError('NOT_FOUND', 'Lead unlock dispute not found.')
  }
  if (dispute.status !== 'OPEN' || dispute.resolvedAt) {
    throw new LeadUnlockDisputeError('ALREADY_RESOLVED', 'This dispute has already been resolved.')
  }
  if (dispute.leadUnlock.status !== 'DISPUTED') {
    throw new LeadUnlockDisputeError(
      'INVALID_STATUS',
      `Cannot reject a ${dispute.leadUnlock.status.toLowerCase()} lead unlock dispute.`,
    )
  }

  const now = new Date()
  const updatedDispute = await tx.leadUnlockDispute.update({
    where: { id: dispute.id },
    data: {
      status: 'REJECTED',
      resolvedAt: now,
      resolvedBy: adminUserId,
      adminNotes: cleanNotes(adminNotes),
    },
  })

  const updatedUnlock = await tx.leadUnlock.update({
    where: { id: dispute.leadUnlockId },
    data: {
      status: 'UNLOCKED',
      resolvedAt: now,
      resolvedBy: adminUserId,
    },
  })

  return {
    unlock: updatedUnlock,
    dispute: updatedDispute,
    wallet: null,
    ledgerEntries: [],
  }
}
