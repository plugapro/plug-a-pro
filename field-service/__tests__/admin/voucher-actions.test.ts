import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth', () => ({
  requireAdmin: vi.fn(),
  requireAdminApi: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    voucherBatch: {
      findMany: vi.fn(),
    },
    promoVoucher: {
      groupBy: vi.fn(),
    },
  },
}))

describe('admin voucher actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not query voucher data when list access is unauthenticated', async () => {
    const { requireAdmin } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    ;(requireAdmin as any).mockRejectedValue(new Error('unauthorized'))

    const { listVoucherBatchesAction } = await import('../../app/(admin)/admin/vouchers/actions')

    await expect(listVoucherBatchesAction()).rejects.toThrow('unauthorized')
    expect(db.voucherBatch.findMany).not.toHaveBeenCalled()
    expect(db.promoVoucher.groupBy).not.toHaveBeenCalled()
  })
})
