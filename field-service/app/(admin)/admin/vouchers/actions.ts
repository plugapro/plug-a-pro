'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { requireAdminApi } from '@/lib/auth'
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
  await requireAdminApi()
  const [batches, grouped] = await Promise.all([
    db.voucherBatch.findMany({ orderBy: { createdAt: 'desc' } }),
    db.promoVoucher.groupBy({
      by: ['batchId', 'status'],
      _count: { id: true },
    }),
  ])

  const countsByBatch = grouped.reduce<Record<string, Record<string, number>>>(
    (acc, row) => {
      if (!acc[row.batchId]) acc[row.batchId] = {}
      acc[row.batchId][row.status] = row._count.id
      return acc
    },
    {},
  )

  return batches.map((b) => {
    const s = countsByBatch[b.id] ?? {}
    const total = Object.values(s).reduce((sum, n) => sum + n, 0)
    return {
      id: b.id,
      name: b.name,
      campaignCode: b.campaignCode,
      creditAmount: b.creditAmount,
      count: b.count,
      expiresAt: b.expiresAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      stats: {
        total,
        active: s['ACTIVE'] ?? 0,
        redeemed: s['REDEEMED'] ?? 0,
        cancelled: s['CANCELLED'] ?? 0,
        expired: s['EXPIRED'] ?? 0,
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
  if (result.ok) revalidatePath('/admin/vouchers')
  return result
}
