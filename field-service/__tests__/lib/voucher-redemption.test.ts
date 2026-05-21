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
    batch: { campaignCode: 'PILOT_PROVIDER_FLYER', name: 'Pilot Flyer' },
    ...overrides,
  }
}

// existingCampaignRecord: null = provider has NOT yet redeemed from this campaign;
//                         object = provider HAS already redeemed (pre-check triggers rejection).
function makeTx(
  providerResult: unknown,
  voucherResult: unknown,
  existingCampaignRecord: unknown = null,
  updateCount = 1,
) {
  const creditEntry = { id: 'ledger_1' }
  mockCreditFn.mockResolvedValue({ ledgerEntries: [creditEntry] })
  return {
    provider: { findUnique: vi.fn().mockResolvedValue(providerResult) },
    promoVoucher: {
      findUnique: vi.fn().mockResolvedValue(voucherResult),
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
    },
    providerCampaignRedemption: {
      findUnique: vi.fn().mockResolvedValue(existingCampaignRecord),
      create: vi.fn().mockResolvedValue({ id: 'pcr_1', providerId: 'prov_1', campaignCode: 'PILOT_PROVIDER_FLYER' }),
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

  it('succeeds: approves credit, marks voucher redeemed, and records campaign redemption', async () => {
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
    expect(tx.providerCampaignRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerId: 'prov_1',
        campaignCode: 'PILOT_PROVIDER_FLYER',
        voucherId: 'vchr_1',
        creditAmount: 1,
      }),
    })
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

  it('rejects: garbage code fails format guard before any DB call', async () => {
    const tx = makeTx(makeProvider(), makeVoucher())
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', 'not-a-real-code')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_NOT_FOUND')
    // DB transaction must NOT have been invoked
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('rejects: code with valid format but no DB match', async () => {
    const tx = makeTx(makeProvider(), null)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', 'PAP-7KQ9-ZZZZ')

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

  it('rejects: cancelled voucher returns CANCELLED not MAX_REDEMPTIONS (ordering guard)', async () => {
    // redemptionCount >= maxRedemptions AND status=CANCELLED — must return CANCELLED, not MAX_REDEMPTIONS
    const tx = makeTx(makeProvider(), makeVoucher({ status: 'CANCELLED', redemptionCount: 1, maxRedemptions: 1 }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_CANCELLED')
  })

  it('rejects: voucher max redemptions reached (count exhausted)', async () => {
    const tx = makeTx(makeProvider(), makeVoucher({ status: 'ACTIVE', redemptionCount: 1, maxRedemptions: 1 }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_MAX_REDEMPTIONS_REACHED')
  })

  it('rejects: voucher expired by date', async () => {
    const tx = makeTx(makeProvider(), makeVoucher({ expiresAt: new Date('2020-01-01') }))
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_EXPIRED')
  })

  it('rejects: provider already redeemed from same campaign — pre-check fires before any claim', async () => {
    const existingRecord = { id: 'pcr_existing' }
    const tx = makeTx(makeProvider(), makeVoucher(), existingRecord)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('PROVIDER_ALREADY_REDEEMED_CAMPAIGN')
    expect(result.message).toBe('You have already redeemed a voucher for this campaign.')

    // Pre-check fires before any write — no voucher claim should be attempted
    expect(tx.promoVoucher.updateMany).not.toHaveBeenCalled()
    expect(tx.providerCampaignRedemption.create).not.toHaveBeenCalled()
    expect(mockCreditFn).not.toHaveBeenCalled()
  })

  it('rejects via DB unique constraint when concurrent requests both pass the pre-check', async () => {
    // Two concurrent requests both read existingCampaignRecord=null and both claim a voucher.
    // The second INSERT into provider_campaign_redemptions raises P2002; the transaction
    // rolls back automatically (including the voucher claim) and we return PROVIDER_ALREADY_REDEEMED_CAMPAIGN.
    const tx = makeTx(makeProvider(), makeVoucher())
    setupTransaction(tx)

    const constraintError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['providerId', 'campaignCode'] },
    })
    tx.providerCampaignRedemption.create.mockRejectedValueOnce(constraintError)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('PROVIDER_ALREADY_REDEEMED_CAMPAIGN')
    // Claim was attempted but the DB rolls it back; wallet must NOT have been credited
    expect(tx.promoVoucher.updateMany).toHaveBeenCalledOnce()
    expect(mockCreditFn).not.toHaveBeenCalled()
  })

  it('rejects on race condition: updateMany returns count=0 (concurrent same-voucher redemption)', async () => {
    const tx = makeTx(makeProvider(), makeVoucher(), null, 0)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('should fail')
    expect(result.code).toBe('VOUCHER_ALREADY_REDEEMED')
    expect(mockCreditFn).not.toHaveBeenCalled()
  })

  it('succeeds: different provider can redeem from the same campaign', async () => {
    // Provider 2 has no existing campaign record → should succeed
    const tx = makeTx(makeProvider({ id: 'prov_2' }), makeVoucher({ id: 'vchr_2' }), null)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_2', RAW_CODE)

    expect(result.ok).toBe(true)
    expect(tx.providerCampaignRedemption.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_campaignCode: { providerId: 'prov_2', campaignCode: 'PILOT_PROVIDER_FLYER' } },
      })
    )
  })

  it('succeeds: same provider can redeem from a different campaign', async () => {
    // Provider already redeemed CAMPAIGN_A (not mocked here); now redeeming CAMPAIGN_B → no record found → success
    const voucher2 = makeVoucher({ batch: { campaignCode: 'CAMPAIGN_B', name: 'Campaign B' } })
    const tx = makeTx(makeProvider(), voucher2, null)
    setupTransaction(tx)

    const result = await redeemVoucher('prov_1', RAW_CODE)

    expect(result.ok).toBe(true)
    expect(tx.providerCampaignRedemption.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_campaignCode: { providerId: 'prov_1', campaignCode: 'CAMPAIGN_B' } },
      })
    )
  })

  it('propagates error when wallet credit throws (transaction rolls back, voucher stays ACTIVE)', async () => {
    const tx = makeTx(makeProvider(), makeVoucher())
    setupTransaction(tx)
    mockCreditFn.mockRejectedValueOnce(new Error('wallet unavailable'))

    await expect(redeemVoucher('prov_1', RAW_CODE)).rejects.toThrow('wallet unavailable')

    // updateMany was called (atomic claim attempted), wallet threw, transaction auto-rolls back
    expect(tx.promoVoucher.updateMany).toHaveBeenCalled()
    expect(tx.providerCampaignRedemption.create).toHaveBeenCalled()
  })

  it('does not grant credits on any failure path', async () => {
    const paths = [
      makeTx(null, makeVoucher()),                                                              // no provider
      makeTx(makeProvider({ active: false }), makeVoucher()),                                  // not approved
      makeTx(makeProvider(), null),                                                            // bad code
      makeTx(makeProvider(), makeVoucher({ status: 'REDEEMED' })),                            // already redeemed
      makeTx(makeProvider(), makeVoucher({ status: 'CANCELLED' })),                           // cancelled
      makeTx(makeProvider(), makeVoucher({ expiresAt: new Date('2020-01-01') })),              // expired
      makeTx(makeProvider(), makeVoucher(), { id: 'pcr_existing' }),                          // campaign already redeemed
    ]

    for (const tx of paths) {
      vi.clearAllMocks()
      setupTransaction(tx)
      mockCreditFn.mockResolvedValue({ ledgerEntries: [{ id: 'l1' }] })
      await redeemVoucher('prov_1', RAW_CODE)
      expect(mockCreditFn).not.toHaveBeenCalled()
    }
  })
})
