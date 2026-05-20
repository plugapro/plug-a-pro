import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Shared mock state ──────────────────────────────────────────────────────────
const { mockDb, mockCreditFn } = vi.hoisted(() => {
  const mockDb = {
    $transaction: vi.fn(),
  }
  const mockCreditFn = vi.fn()
  return { mockDb, mockCreditFn }
})

vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/provider-wallet', () => ({
  creditVoucherRedemptionInTransaction: mockCreditFn,
}))

import { redeemVoucher } from '../../lib/voucher-redemption'
import { voucherCodeToHash } from '../../lib/vouchers'

// ── Factories ──────────────────────────────────────────────────────────────────
const RAW_CODE = 'PAP-7KQ9-M2XD'
const CODE_HASH = voucherCodeToHash(RAW_CODE)

function makeProvider(overrides: Record<string, unknown> = {}) {
  return { id: 'prov_1', phone: '+27821111111', active: true, status: 'ACTIVE', ...overrides }
}

function makeVoucher(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vchr_1',
    codeHash: CODE_HASH,
    status: 'ACTIVE',
    creditAmount: 1,
    maxRedemptions: 1,
    redemptionCount: 0,
    expiresAt: null,
    redeemedByProviderId: null,
    batch: { campaignCode: 'PILOT_PROVIDER_FLYER' },
    ...overrides,
  }
}

function makeTx(providerResult: unknown, voucherResult: unknown, existingRedemption: unknown = null, updateCount = 1) {
  const creditEntry = { id: 'ledger_1' }
  mockCreditFn.mockResolvedValue({ ledgerEntries: [creditEntry] })
  return {
    provider: { findUnique: vi.fn().mockResolvedValue(providerResult) },
    promoVoucher: {
      findUnique: vi.fn().mockResolvedValue(voucherResult),
      findFirst: vi.fn().mockResolvedValue(existingRedemption),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
  }
}

function setupTransaction(tx: ReturnType<typeof makeTx>) {
  mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx))
}

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('redeemVoucher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('succeeds: approves credit and marks voucher redeemed', async () => {
    const tx = makeTx(makeProvider(), makeVoucher())
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('should be ok')
    expect(result.creditsAwarded).toBe(1)
    expect(result.ledgerEntryId).toBe('ledger_1')

    expect(tx.promoVoucher.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'vchr_1', status: 'ACTIVE' }),
        data: expect.objectContaining({ status: 'REDEEMED', redeemedByProviderId: 'prov_1' }),
      })
    )
    expect(mockCreditFn).toHaveBeenCalledWith(
      tx,
      'prov_1',
      1,
      expect.objectContaining({ referenceType: 'voucher', referenceId: 'vchr_1' })
    )
  })

  it('rejects: provider not found', async () => {
    const tx = makeTx(null, makeVoucher())
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('PROVIDER_NOT_FOUND')
  })

  it('rejects: provider not active (not yet approved)', async () => {
    const tx = makeTx(makeProvider({ active: false }), makeVoucher())
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('PROVIDER_NOT_APPROVED')
  })

  it('rejects: invalid voucher code (no hash match)', async () => {
    const tx = makeTx(makeProvider(), null)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', 'PAP-FAKE-CODE')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_NOT_FOUND')
  })

  it('rejects: voucher already redeemed (status)', async () => {
    const tx = makeTx(makeProvider(), makeVoucher({ status: 'REDEEMED', redemptionCount: 1 }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_ALREADY_REDEEMED')
  })

  it('rejects: voucher max redemptions reached (count exhausted)', async () => {
    const tx = makeTx(makeProvider(), makeVoucher({ status: 'ACTIVE', redemptionCount: 1, maxRedemptions: 1 }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_MAX_REDEMPTIONS_REACHED')
  })

  it('rejects: voucher cancelled', async () => {
    const tx = makeTx(makeProvider(), makeVoucher({ status: 'CANCELLED' }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_CANCELLED')
  })

  it('rejects: voucher expired by date', async () => {
    const tx = makeTx(makeProvider(), makeVoucher({ expiresAt: new Date('2020-01-01') }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_EXPIRED')
  })

  it('rejects: provider already redeemed a voucher from the same campaign', async () => {
    const existingRedemption = { id: 'vchr_old' }
    const tx = makeTx(makeProvider(), makeVoucher(), existingRedemption)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('PROVIDER_ALREADY_REDEEMED_CAMPAIGN')
  })

  it('rejects on race condition: updateMany returns count=0 (concurrent redemption)', async () => {
    const tx = makeTx(makeProvider(), makeVoucher(), null, 0)  // updateMany returns 0
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_ALREADY_REDEEMED')
    // Wallet must NOT have been credited
    expect(mockCreditFn).not.toHaveBeenCalled()
  })

  it('does not grant credits on any failure path', async () => {
    const paths = [
      makeTx(null, makeVoucher()),                                            // no provider
      makeTx(makeProvider({ active: false }), makeVoucher()),                 // not approved
      makeTx(makeProvider(), null),                                           // bad code
      makeTx(makeProvider(), makeVoucher({ status: 'REDEEMED' })),           // already redeemed
      makeTx(makeProvider(), makeVoucher({ status: 'CANCELLED' })),          // cancelled
      makeTx(makeProvider(), makeVoucher({ expiresAt: new Date('2020-01-01') })),  // expired
      makeTx(makeProvider(), makeVoucher(), { id: 'vchr_old' }),             // campaign duplicate
    ]

    for (const tx of paths) {
      vi.clearAllMocks()
      setupTransaction(tx)
      await redeemVoucher('prov_1', RAW_CODE)
      expect(mockCreditFn).not.toHaveBeenCalled()
    }
  })
})
