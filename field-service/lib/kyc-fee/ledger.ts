import { Prisma, type KycFeeLedgerEntry, type KycFeeLedgerReason } from '@prisma/client'
import { db } from '../db'

// Narrow structural type so both the root client and an interactive
// transaction client (and test fakes) satisfy it.
export type KycFeeLedgerTx = Pick<Prisma.TransactionClient, 'kycFeeLedgerEntry'>

export class KycFeeLedgerError extends Error {
  constructor(
    public readonly code: 'INVALID_AMOUNT' | 'NEGATIVE_BALANCE',
    message: string,
  ) {
    super(message)
    this.name = 'KycFeeLedgerError'
  }
}

// ACCRUED/REVERSED increase what the provider owes; the rest settle it.
const BALANCE_DELTA: Record<KycFeeLedgerReason, 1 | -1> = {
  KYC_FEE_ACCRUED: 1,
  KYC_FEE_REVERSED: 1,
  KYC_FEE_SPONSORED: -1,
  KYC_FEE_RECOVERED: -1,
  KYC_FEE_WAIVED: -1,
}

export type WriteKycFeeLedgerEntryParams = {
  providerId: string
  reason: KycFeeLedgerReason
  amountCents: number
  referenceType: string
  referenceId: string
  campaignId?: string | null
  description?: string | null
  idempotencyKey?: string | null
  source?: 'system' | 'admin'
  createdBy?: string | null
  metadata?: Record<string, unknown>
}

function toJson(metadata: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue
}

/**
 * Appends an immutable fee ledger row. MUST be called inside the caller's
 * transaction together with whatever business write it belongs to.
 * Balance is recomputed from the latest row (single once-off fee per
 * provider keeps contention negligible).
 */
export async function writeKycFeeLedgerEntryInTransaction(
  tx: KycFeeLedgerTx,
  params: WriteKycFeeLedgerEntryParams,
): Promise<KycFeeLedgerEntry> {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw new KycFeeLedgerError(
      'INVALID_AMOUNT',
      `amountCents must be a positive integer, got ${params.amountCents}.`,
    )
  }

  const prev = await tx.kycFeeLedgerEntry.findFirst({
    where: { providerId: params.providerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { balanceAfterCents: true },
  })

  const balanceAfterCents =
    (prev?.balanceAfterCents ?? 0) + BALANCE_DELTA[params.reason] * params.amountCents

  if (balanceAfterCents < 0) {
    throw new KycFeeLedgerError(
      'NEGATIVE_BALANCE',
      `Entry ${params.reason} of ${params.amountCents}c would drive provider ${params.providerId} balance negative.`,
    )
  }

  return tx.kycFeeLedgerEntry.create({
    data: {
      providerId: params.providerId,
      reason: params.reason,
      amountCents: params.amountCents,
      balanceAfterCents,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      campaignId: params.campaignId ?? null,
      description: params.description ?? null,
      idempotencyKey: params.idempotencyKey ?? undefined,
      source: params.source ?? undefined,
      createdBy: params.createdBy ?? undefined,
      metadata: toJson(params.metadata),
    },
  })
}

export type KycFeeStatus = {
  outstandingCents: number
  lastReason: KycFeeLedgerReason | null
}

export async function getKycFeeStatus(
  providerId: string,
  client: KycFeeLedgerTx = db,
): Promise<KycFeeStatus> {
  const last = await client.kycFeeLedgerEntry.findFirst({
    where: { providerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { balanceAfterCents: true, reason: true },
  })
  return {
    outstandingCents: last?.balanceAfterCents ?? 0,
    lastReason: last?.reason ?? null,
  }
}
