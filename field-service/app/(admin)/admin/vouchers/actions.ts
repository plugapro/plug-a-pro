'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { z } from 'zod'

const FLAG = 'admin.vouchers'

export type VoucherBatchSummary = {
  id: string
  name: string
  campaignCode: string
  creditAmount: number
  count: number
  expiresAt: string | null
  createdAt: string
  stats: {
    total: number
    active: number
    redeemed: number
    cancelled: number
    expired: number
  }
}

export async function listVoucherBatchesAction(): Promise<VoucherBatchSummary[]> {
  const batches = await db.voucherBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { vouchers: true } },
      vouchers: {
        select: { status: true },
      },
    },
  })

  return batches.map((b) => {
    const statusCounts = b.vouchers.reduce(
      (acc, v) => { acc[v.status] = (acc[v.status] ?? 0) + 1; return acc },
      {} as Record<string, number>,
    )
    return {
      id: b.id,
      name: b.name,
      campaignCode: b.campaignCode,
      creditAmount: b.creditAmount,
      count: b.count,
      expiresAt: b.expiresAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      stats: {
        total: b._count.vouchers,
        active: statusCounts['ACTIVE'] ?? 0,
        redeemed: statusCounts['REDEEMED'] ?? 0,
        cancelled: statusCounts['CANCELLED'] ?? 0,
        expired: statusCounts['EXPIRED'] ?? 0,
      },
    }
  })
}

const CancelVoucherSchema = z.object({ voucherId: z.string().min(1) })

export async function cancelVoucherAction(input: z.infer<typeof CancelVoucherSchema>) {
  const result = await crudAction<z.infer<typeof CancelVoucherSchema>, { id: string }>({
    entity: 'PromoVoucher',
    action: 'admin.voucher.cancel',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: CancelVoucherSchema,
    input,
    run: async (data, tx) => {
      const voucher = await tx.promoVoucher.findUnique({
        where: { id: data.voucherId },
        select: { id: true, status: true },
      })
      if (!voucher) throw new CrudActionError('NOT_FOUND', 'Voucher not found')
      if (voucher.status !== 'ACTIVE') throw new CrudActionError('CONFLICT', 'Only ACTIVE vouchers can be cancelled')
      const updated = await tx.promoVoucher.update({
        where: { id: data.voucherId },
        data: { status: 'CANCELLED' },
        select: { id: true },
      })
      return updated
    },
  })
  revalidatePath('/admin/vouchers')
  return result
}
