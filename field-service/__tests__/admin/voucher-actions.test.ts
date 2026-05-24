import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

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

  it('does not list voucher batches when admin auth fails', async () => {
    const { requireAdmin, requireAdminApi } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(requireAdmin as any).mockRejectedValue(new Error('unauthorized'))
    ;(requireAdminApi as any).mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    ;(db.voucherBatch.findMany as any).mockResolvedValue([])
    ;(db.promoVoucher.groupBy as any).mockResolvedValue([])

    const { listVoucherBatchesAction } = await import('../../app/(admin)/admin/vouchers/actions')

    await expect(listVoucherBatchesAction()).rejects.toThrow('unauthorized')
    expect(db.voucherBatch.findMany).not.toHaveBeenCalled()
    expect(db.promoVoucher.groupBy).not.toHaveBeenCalled()
  })
})
