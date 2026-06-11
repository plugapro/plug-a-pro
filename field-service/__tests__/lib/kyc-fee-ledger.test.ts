import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KycFeeLedgerError,
  writeKycFeeLedgerEntryInTransaction,
  type KycFeeLedgerTx,
} from '../../lib/kyc-fee/ledger'

function makeTx(lastBalanceCents: number | null) {
  const created: unknown[] = []
  const tx = {
    kycFeeLedgerEntry: {
      findFirst: vi.fn().mockResolvedValue(
        lastBalanceCents === null ? null : { balanceAfterCents: lastBalanceCents },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data)
        return { id: 'entry-1', ...data }
      }),
    },
  }
  return { tx: tx as unknown as KycFeeLedgerTx, created, raw: tx }
}

const baseParams = {
  providerId: 'provider-1',
  referenceType: 'provider_identity_verification',
  referenceId: 'verif-1',
} as const

describe('writeKycFeeLedgerEntryInTransaction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('books a first accrual with balanceAfter = amount', async () => {
    const { tx, created } = makeTx(null)
    const entry = await writeKycFeeLedgerEntryInTransaction(tx, {
      ...baseParams,
      reason: 'KYC_FEE_ACCRUED',
      amountCents: 2000,
    })
    expect(entry.balanceAfterCents).toBe(2000)
    expect(created).toHaveLength(1)
  })

  it('a sponsorship after an accrual zeroes the balance', async () => {
    const { tx } = makeTx(2000)
    const entry = await writeKycFeeLedgerEntryInTransaction(tx, {
      ...baseParams,
      reason: 'KYC_FEE_SPONSORED',
      amountCents: 2000,
      campaignId: 'camp-1',
    })
    expect(entry.balanceAfterCents).toBe(0)
  })

  it('a reversal restores the outstanding balance', async () => {
    const { tx } = makeTx(0)
    const entry = await writeKycFeeLedgerEntryInTransaction(tx, {
      ...baseParams,
      reason: 'KYC_FEE_REVERSED',
      amountCents: 2000,
    })
    expect(entry.balanceAfterCents).toBe(2000)
  })

  it('rejects a write that would drive the balance negative', async () => {
    const { tx } = makeTx(0)
    await expect(
      writeKycFeeLedgerEntryInTransaction(tx, {
        ...baseParams,
        reason: 'KYC_FEE_WAIVED',
        amountCents: 2000,
      }),
    ).rejects.toBeInstanceOf(KycFeeLedgerError)
  })

  it('rejects non-positive or non-integer amounts', async () => {
    const { tx } = makeTx(null)
    for (const amountCents of [0, -5, 19.5]) {
      await expect(
        writeKycFeeLedgerEntryInTransaction(tx, {
          ...baseParams,
          reason: 'KYC_FEE_ACCRUED',
          amountCents,
        }),
      ).rejects.toBeInstanceOf(KycFeeLedgerError)
    }
  })
})
