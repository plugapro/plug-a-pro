import {
  Prisma,
  type ProviderWallet,
  type WalletCreditType,
  type WalletLedgerEntry,
} from '@prisma/client'
import { randomUUID } from 'crypto'
import { db } from './db'

export const PLUG_A_PRO_CREDIT_VALUE_CENTS = 2_000

type WalletErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_REFERENCE'
  | 'INVALID_REASON'
  | 'INSUFFICIENT_FUNDS'
  | 'WALLET_NOT_ACTIVE'
  | 'CONCURRENT_MUTATION'

export class ProviderWalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderWalletError'
  }
}

export type WalletReference = {
  referenceType: string
  referenceId: string
  description?: string
  metadata?: Record<string, unknown>
  createdBy?: string | null
}

export type ProviderWalletBalance = {
  providerId: string
  paidCreditBalance: number
  promoCreditBalance: number
  totalCreditBalance: number
  status: ProviderWallet['status']
}

export type ProviderWalletLedgerEntryOptions = {
  limit?: number
  cursor?: string
  referenceType?: string
  referenceId?: string
}

export type WalletMutationResult = {
  wallet: ProviderWallet
  ledgerEntries: WalletLedgerEntry[]
}

type WalletTx = Prisma.TransactionClient
type WalletLedgerEntryType = WalletLedgerEntry['entryType'] | 'WALLET_SUSPENDED' | 'WALLET_REACTIVATED'

function assertPositiveIntegerCredits(amountCredits: number) {
  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    throw new ProviderWalletError(
      'INVALID_AMOUNT',
      'Credit amount must be a positive whole number.',
    )
  }
}

function assertReference(reference: WalletReference) {
  if (!reference.referenceType.trim() || !reference.referenceId.trim()) {
    throw new ProviderWalletError(
      'INVALID_REFERENCE',
      'Wallet ledger entries require referenceType and referenceId.',
    )
  }
}

function assertAdminReason(reason: string) {
  if (!reason.trim()) {
    throw new ProviderWalletError(
      'INVALID_REASON',
      'Admin wallet actions require a reason.',
    )
  }
}

function assertWalletActive(wallet: ProviderWallet) {
  if (wallet.status !== 'ACTIVE') {
    throw new ProviderWalletError(
      'WALLET_NOT_ACTIVE',
      `Provider wallet is ${wallet.status.toLowerCase()}.`,
    )
  }
}

function toJson(metadata: WalletReference['metadata']): Prisma.InputJsonValue {
  // Prisma JSON inputs cannot contain undefined values; JSON serialization drops
  // them and keeps ledger metadata deterministic.
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue
}

async function getOrCreateProviderWalletInTx(tx: WalletTx, providerId: string) {
  return tx.providerWallet.upsert({
    where: { providerId },
    create: { providerId },
    update: {},
  })
}

function toBalance(wallet: ProviderWallet): ProviderWalletBalance {
  return {
    providerId: wallet.providerId,
    paidCreditBalance: wallet.paidCreditBalance,
    promoCreditBalance: wallet.promoCreditBalance,
    totalCreditBalance: wallet.paidCreditBalance + wallet.promoCreditBalance,
    status: wallet.status,
  }
}

async function createLedgerEntry(
  tx: WalletTx,
  params: {
    walletId: string
    providerId: string
    entryType: WalletLedgerEntryType
    creditType: WalletCreditType
    amountCredits: number
    balanceAfterPaidCredits: number
    balanceAfterPromoCredits: number
    reference: WalletReference
  },
) {
  return tx.walletLedgerEntry.create({
    data: {
      walletId: params.walletId,
      providerId: params.providerId,
      entryType: params.entryType as WalletLedgerEntry['entryType'],
      creditType: params.creditType,
      amountCredits: params.amountCredits,
      balanceAfterPaidCredits: params.balanceAfterPaidCredits,
      balanceAfterPromoCredits: params.balanceAfterPromoCredits,
      referenceType: params.reference.referenceType,
      referenceId: params.reference.referenceId,
      description: params.reference.description,
      metadata: toJson(params.reference.metadata),
      createdBy: params.reference.createdBy ?? undefined,
    },
  })
}

export async function creditPaidCreditsInTransaction(
  tx: WalletTx,
  providerId: string,
  amountCredits: number,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)
  assertWalletActive(wallet)

  // Balance and ledger writes share the caller's transaction so higher-level
  // finance flows can atomically update their own reconciliation records too.
  const updatedWallet = await tx.providerWallet.update({
    where: { id: wallet.id },
    data: { paidCreditBalance: { increment: amountCredits } },
  })

  const ledgerEntry = await createLedgerEntry(tx, {
    walletId: updatedWallet.id,
    providerId,
    entryType: 'TOPUP_CREDIT',
    creditType: 'PAID',
    amountCredits,
    balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
    balanceAfterPromoCredits: updatedWallet.promoCreditBalance,
    reference,
  })

  return { wallet: updatedWallet, ledgerEntries: [ledgerEntry] }
}

export async function creditPromoCreditsInTransaction(
  tx: WalletTx,
  providerId: string,
  amountCredits: number,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)
  assertWalletActive(wallet)

  // Promo credits use the same immutable ledger path as paid credits, but they
  // stay in their own balance bucket so they cannot be treated as cash value.
  const updatedWallet = await tx.providerWallet.update({
    where: { id: wallet.id },
    data: { promoCreditBalance: { increment: amountCredits } },
  })

  const ledgerEntry = await createLedgerEntry(tx, {
    walletId: updatedWallet.id,
    providerId,
    entryType: 'PROMO_CREDIT',
    creditType: 'PROMO',
    amountCredits,
    balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
    balanceAfterPromoCredits: updatedWallet.promoCreditBalance,
    reference,
  })

  return { wallet: updatedWallet, ledgerEntries: [ledgerEntry] }
}

export async function debitCreditsForLeadUnlockInTransaction(
  tx: WalletTx,
  providerId: string,
  amountCredits: number,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)
  assertWalletActive(wallet)

  const totalAvailableCredits = wallet.paidCreditBalance + wallet.promoCreditBalance
  if (totalAvailableCredits < amountCredits) {
    throw new ProviderWalletError(
      'INSUFFICIENT_FUNDS',
      'Provider wallet does not have enough credits.',
    )
  }

  // Promo credits are product credits only: consume them first so providers
  // keep paid credits for later when promo credit is available.
  const promoDebit = Math.min(wallet.promoCreditBalance, amountCredits)
  const paidDebit = amountCredits - promoDebit
  const balanceAfterPromoDebit = wallet.promoCreditBalance - promoDebit
  const balanceAfterPaidDebit = wallet.paidCreditBalance - paidDebit

  // Optimistic concurrency guard: if another unlock changed either balance
  // between read and write, this update affects zero rows instead of allowing
  // stale-balance accounting or a negative balance.
  const updated = await tx.providerWallet.updateMany({
    where: {
      id: wallet.id,
      AND: [
        { paidCreditBalance: wallet.paidCreditBalance },
        { promoCreditBalance: wallet.promoCreditBalance },
        { paidCreditBalance: { gte: paidDebit } },
        { promoCreditBalance: { gte: promoDebit } },
      ],
    },
    data: {
      paidCreditBalance: { decrement: paidDebit },
      promoCreditBalance: { decrement: promoDebit },
    },
  })

  if (updated.count !== 1) {
    throw new ProviderWalletError(
      'CONCURRENT_MUTATION',
      'Provider wallet changed while processing the debit. Retry the unlock.',
    )
  }

  const ledgerEntries: WalletLedgerEntry[] = []

  if (promoDebit > 0) {
    ledgerEntries.push(
      await createLedgerEntry(tx, {
        walletId: wallet.id,
        providerId,
        entryType: 'LEAD_UNLOCK_DEBIT',
        creditType: 'PROMO',
        amountCredits: promoDebit,
        balanceAfterPaidCredits: wallet.paidCreditBalance,
        balanceAfterPromoCredits: balanceAfterPromoDebit,
        reference,
      }),
    )
  }

  if (paidDebit > 0) {
    ledgerEntries.push(
      await createLedgerEntry(tx, {
        walletId: wallet.id,
        providerId,
        entryType: 'LEAD_UNLOCK_DEBIT',
        creditType: 'PAID',
        amountCredits: paidDebit,
        balanceAfterPaidCredits: balanceAfterPaidDebit,
        balanceAfterPromoCredits: balanceAfterPromoDebit,
        reference,
      }),
    )
  }

  const finalWallet = await tx.providerWallet.findUniqueOrThrow({
    where: { id: wallet.id },
  })

  return { wallet: finalWallet, ledgerEntries }
}

export async function getOrCreateProviderWallet(providerId: string) {
  return getOrCreateProviderWalletInTx(db as unknown as WalletTx, providerId)
}

export async function getProviderWalletBalance(
  providerId: string,
): Promise<ProviderWalletBalance> {
  const wallet = await getOrCreateProviderWallet(providerId)
  return toBalance(wallet)
}

export async function getProviderWalletLedgerEntries(
  providerId: string,
  options: ProviderWalletLedgerEntryOptions = {},
): Promise<WalletLedgerEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const where: Prisma.WalletLedgerEntryWhereInput = {
    providerId,
    ...(options.referenceType ? { referenceType: options.referenceType } : {}),
    ...(options.referenceId ? { referenceId: options.referenceId } : {}),
  }

  return db.walletLedgerEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  })
}

export async function creditPaidCredits(
  providerId: string,
  amountCredits: number,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  return db.$transaction(async (tx) => {
    return creditPaidCreditsInTransaction(tx, providerId, amountCredits, reference)
  })
}

export async function creditPromoCredits(
  providerId: string,
  amountCredits: number,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  return db.$transaction(async (tx) => {
    return creditPromoCreditsInTransaction(tx, providerId, amountCredits, reference)
  })
}

export async function debitCreditsForLeadUnlock(
  providerId: string,
  amountCredits: number,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  return db.$transaction(async (tx) => {
    return debitCreditsForLeadUnlockInTransaction(tx, providerId, amountCredits, reference)
  })
}

export async function refundCredits(
  providerId: string,
  amountCredits: number,
  creditType: WalletCreditType,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  return db.$transaction(async (tx) => {
    return refundCreditsInTransaction(tx, providerId, amountCredits, creditType, reference)
  })
}

export async function refundCreditsInTransaction(
  tx: WalletTx,
  providerId: string,
  amountCredits: number,
  creditType: WalletCreditType,
  reference: WalletReference,
): Promise<WalletMutationResult> {
  assertPositiveIntegerCredits(amountCredits)
  assertReference(reference)

  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)
  assertWalletActive(wallet)

  // Refunds restore the same credit bucket where possible so promo and paid
  // credits remain auditable and are not mixed after a dispute decision.
  const updatedWallet = await tx.providerWallet.update({
    where: { id: wallet.id },
    data:
      creditType === 'PAID'
        ? { paidCreditBalance: { increment: amountCredits } }
        : { promoCreditBalance: { increment: amountCredits } },
  })

  const ledgerEntry = await createLedgerEntry(tx, {
    walletId: updatedWallet.id,
    providerId,
    entryType: 'LEAD_REFUND_CREDIT',
    creditType,
    amountCredits,
    balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
    balanceAfterPromoCredits: updatedWallet.promoCreditBalance,
    reference,
  })

  return { wallet: updatedWallet, ledgerEntries: [ledgerEntry] }
}

export async function adjustProviderCreditsInTransaction(
  tx: WalletTx,
  providerId: string,
  creditType: WalletCreditType,
  amountCredits: number,
  reason: string,
  adminUserId: string,
): Promise<WalletMutationResult> {
  if (!Number.isInteger(amountCredits) || amountCredits === 0) {
    throw new ProviderWalletError(
      'INVALID_AMOUNT',
      'Admin adjustment amount must be a non-zero whole number.',
    )
  }
  assertAdminReason(reason)

  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)
  const absoluteAmount = Math.abs(amountCredits)

  let updatedWallet: ProviderWallet
  if (amountCredits > 0) {
    updatedWallet = await tx.providerWallet.update({
      where: { id: wallet.id },
      data: creditType === 'PAID'
        ? { paidCreditBalance: { increment: amountCredits } }
        : { promoCreditBalance: { increment: amountCredits } },
    })
  } else {
    const targetBalanceKey = creditType === 'PAID'
      ? 'paidCreditBalance'
      : 'promoCreditBalance'
    const existingTargetBalance = wallet[targetBalanceKey]

    if (existingTargetBalance < absoluteAmount) {
      throw new ProviderWalletError(
        'INSUFFICIENT_FUNDS',
        'Admin adjustment cannot make provider credits negative.',
      )
    }

    // Negative adjustments use the same optimistic guard as lead unlocks so a
    // concurrent wallet change cannot make the cached balance go below zero.
    const updated = await tx.providerWallet.updateMany({
      where: {
        id: wallet.id,
        AND: [
          { paidCreditBalance: wallet.paidCreditBalance },
          { promoCreditBalance: wallet.promoCreditBalance },
          { [targetBalanceKey]: { gte: absoluteAmount } },
        ],
      },
      data: creditType === 'PAID'
        ? { paidCreditBalance: { decrement: absoluteAmount } }
        : { promoCreditBalance: { decrement: absoluteAmount } },
    })

    if (updated.count !== 1) {
      throw new ProviderWalletError(
        'CONCURRENT_MUTATION',
        'Provider wallet changed while processing the admin adjustment.',
      )
    }

    updatedWallet = await tx.providerWallet.findUniqueOrThrow({
      where: { id: wallet.id },
    })
  }

  const ledgerEntry = await createLedgerEntry(tx, {
    walletId: updatedWallet.id,
    providerId,
    entryType: 'ADMIN_ADJUSTMENT',
    creditType,
    amountCredits,
    balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
    balanceAfterPromoCredits: updatedWallet.promoCreditBalance,
    reference: {
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      description: `Admin adjustment: ${reason.trim()}`,
      metadata: {
        reason: reason.trim(),
        adjustedBy: adminUserId,
      },
      createdBy: adminUserId,
    },
  })

  return { wallet: updatedWallet, ledgerEntries: [ledgerEntry] }
}

export async function adjustProviderCredits(
  providerId: string,
  creditType: WalletCreditType,
  amountCredits: number,
  reason: string,
  adminUserId: string,
): Promise<WalletMutationResult> {
  return db.$transaction(async (tx) => {
    return adjustProviderCreditsInTransaction(
      tx,
      providerId,
      creditType,
      amountCredits,
      reason,
      adminUserId,
    )
  })
}

export async function suspendProviderWalletInTransaction(
  tx: WalletTx,
  providerId: string,
  reason: string,
  adminUserId: string,
) {
  assertAdminReason(reason)
  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)

  const updatedWallet = await tx.providerWallet.update({
    where: { id: wallet.id },
    data: { status: 'SUSPENDED' },
  })

  await createLedgerEntry(tx, {
    walletId: updatedWallet.id,
    providerId,
    entryType: 'WALLET_SUSPENDED',
    creditType: 'PROMO',
    amountCredits: 0,
    balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
    balanceAfterPromoCredits: updatedWallet.promoCreditBalance,
    reference: {
      referenceType: 'wallet_status',
      referenceId: updatedWallet.id,
      description: `Wallet suspended: ${reason.trim()}`,
      metadata: {
        reason: reason.trim(),
        suspendedBy: adminUserId,
      },
      createdBy: adminUserId,
    },
  })

  return updatedWallet
}

export async function suspendProviderWallet(
  providerId: string,
  reason: string,
  adminUserId: string,
) {
  return db.$transaction(async (tx) => {
    return suspendProviderWalletInTransaction(tx, providerId, reason, adminUserId)
  })
}

export async function reactivateProviderWalletInTransaction(
  tx: WalletTx,
  providerId: string,
  reason: string,
  adminUserId: string,
) {
  assertAdminReason(reason)
  const wallet = await getOrCreateProviderWalletInTx(tx, providerId)

  const updatedWallet = await tx.providerWallet.update({
    where: { id: wallet.id },
    data: { status: 'ACTIVE' },
  })

  await createLedgerEntry(tx, {
    walletId: updatedWallet.id,
    providerId,
    entryType: 'WALLET_REACTIVATED',
    creditType: 'PROMO',
    amountCredits: 0,
    balanceAfterPaidCredits: updatedWallet.paidCreditBalance,
    balanceAfterPromoCredits: updatedWallet.promoCreditBalance,
    reference: {
      referenceType: 'wallet_status',
      referenceId: updatedWallet.id,
      description: `Wallet reactivated: ${reason.trim()}`,
      metadata: {
        reason: reason.trim(),
        reactivatedBy: adminUserId,
      },
      createdBy: adminUserId,
    },
  })

  return updatedWallet
}

export async function reactivateProviderWallet(
  providerId: string,
  reason: string,
  adminUserId: string,
) {
  return db.$transaction(async (tx) => {
    return reactivateProviderWalletInTransaction(tx, providerId, reason, adminUserId)
  })
}
