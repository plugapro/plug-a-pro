'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { type WalletCreditType } from '@prisma/client'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { requireAdmin } from '@/lib/auth'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { db } from '@/lib/db'
import {
  ProviderWalletError,
  adjustProviderCreditsInTransaction,
  reactivateProviderWalletInTransaction,
  suspendProviderWalletInTransaction,
} from '@/lib/provider-wallet'

const MANAGE_WALLET_ROLES = ['OPS'] as const

const AdjustProviderCreditsSchema = z.object({
  providerId: z.string().min(1),
  creditType: z.enum(['PAID', 'PROMO']),
  amountCredits: z.number().int().refine((value) => value !== 0, {
    message: 'Adjustment amount must not be zero.',
  }),
  reason: z.string().min(1).max(1_000),
  confirmAdjustment: z.boolean().refine((value) => value, {
    message: 'Confirm the admin adjustment before submitting.',
  }),
})

const WalletStatusSchema = z.object({
  providerId: z.string().min(1),
  reason: z.string().min(1).max(1_000),
})

type AdjustProviderCreditsInput = z.infer<typeof AdjustProviderCreditsSchema>
type WalletStatusInput = z.infer<typeof WalletStatusSchema>

function providerWalletPath(providerId?: string, message?: string) {
  const base = providerId
    ? `/admin/provider-wallets/${providerId}`
    : '/admin/provider-wallets'
  return message ? `${base}?message=${message}` : base
}

function mapWalletError(error: unknown): never {
  if (error instanceof ProviderWalletError) {
    const code = error.code === 'INVALID_REASON' || error.code === 'INVALID_AMOUNT'
      ? 'VALIDATION'
      : 'CONFLICT'
    throw new CrudActionError(code, error.message)
  }
  throw error
}

export async function adjustProviderCreditsAction(input: AdjustProviderCreditsInput) {
  const admin = await requireAdmin()
  const before = await db.providerWallet.findUnique({
    where: { providerId: input.providerId },
  })

  const result = await crudAction<
    AdjustProviderCreditsInput,
    {
      walletId: string
      status: string
      paidCreditBalance: number
      promoCreditBalance: number
      ledgerEntryId: string
    }
  >({
    entity: AUDIT_ENTITY.PROVIDER_WALLET,
    entityId: before?.id ?? input.providerId,
    action: 'provider_wallet.admin_adjustment',
    requiredRole: [...MANAGE_WALLET_ROLES],
    schema: AdjustProviderCreditsSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      try {
        const adjustment = await adjustProviderCreditsInTransaction(
          tx,
          data.providerId,
          data.creditType,
          data.amountCredits,
          data.reason,
          admin.adminUserId ?? admin.id,
        )
        return {
          walletId: adjustment.wallet.id,
          status: adjustment.wallet.status,
          paidCreditBalance: adjustment.wallet.paidCreditBalance,
          promoCreditBalance: adjustment.wallet.promoCreditBalance,
          ledgerEntryId: adjustment.ledgerEntries[0]?.id ?? '',
        }
      } catch (error) {
        mapWalletError(error)
      }
    },
  })

  revalidatePath('/admin/provider-wallets')
  revalidatePath(`/admin/provider-wallets/${input.providerId}`)
  return result
}

export async function suspendProviderWalletAction(input: WalletStatusInput) {
  const admin = await requireAdmin()
  const before = await db.providerWallet.findUnique({
    where: { providerId: input.providerId },
  })

  const result = await crudAction<WalletStatusInput, { walletId: string; status: string }>({
    entity: AUDIT_ENTITY.PROVIDER_WALLET,
    entityId: before?.id ?? input.providerId,
    action: 'provider_wallet.suspend',
    requiredRole: [...MANAGE_WALLET_ROLES],
    schema: WalletStatusSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      try {
        const wallet = await suspendProviderWalletInTransaction(
          tx,
          data.providerId,
          data.reason,
          admin.adminUserId ?? admin.id,
        )
        return { walletId: wallet.id, status: wallet.status }
      } catch (error) {
        mapWalletError(error)
      }
    },
  })

  revalidatePath('/admin/provider-wallets')
  revalidatePath(`/admin/provider-wallets/${input.providerId}`)
  return result
}

export async function reactivateProviderWalletAction(input: WalletStatusInput) {
  const admin = await requireAdmin()
  const before = await db.providerWallet.findUnique({
    where: { providerId: input.providerId },
  })

  const result = await crudAction<WalletStatusInput, { walletId: string; status: string }>({
    entity: AUDIT_ENTITY.PROVIDER_WALLET,
    entityId: before?.id ?? input.providerId,
    action: 'provider_wallet.reactivate',
    requiredRole: [...MANAGE_WALLET_ROLES],
    schema: WalletStatusSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      try {
        const wallet = await reactivateProviderWalletInTransaction(
          tx,
          data.providerId,
          data.reason,
          admin.adminUserId ?? admin.id,
        )
        return { walletId: wallet.id, status: wallet.status }
      } catch (error) {
        mapWalletError(error)
      }
    },
  })

  revalidatePath('/admin/provider-wallets')
  revalidatePath(`/admin/provider-wallets/${input.providerId}`)
  return result
}

export async function adjustProviderCreditsFormAction(formData: FormData) {
  const providerId = String(formData.get('providerId') ?? '')

  try {
    await adjustProviderCreditsAction({
      providerId,
      creditType: String(formData.get('creditType') ?? '') as WalletCreditType,
      amountCredits: Number(formData.get('amountCredits')),
      reason: String(formData.get('reason') ?? '').trim(),
      confirmAdjustment: formData.get('confirmAdjustment') === 'on',
    })
    redirect(providerWalletPath(providerId, 'adjusted'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(providerWalletPath(providerId, 'adjust_failed'))
    }
    throw error
  }
}

export async function suspendProviderWalletFormAction(formData: FormData) {
  const providerId = String(formData.get('providerId') ?? '')

  try {
    await suspendProviderWalletAction({
      providerId,
      reason: String(formData.get('reason') ?? '').trim(),
    })
    redirect(providerWalletPath(providerId, 'suspended'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(providerWalletPath(providerId, 'suspend_failed'))
    }
    throw error
  }
}

export async function reactivateProviderWalletFormAction(formData: FormData) {
  const providerId = String(formData.get('providerId') ?? '')

  try {
    await reactivateProviderWalletAction({
      providerId,
      reason: String(formData.get('reason') ?? '').trim(),
    })
    redirect(providerWalletPath(providerId, 'reactivated'))
  } catch (error) {
    if (error instanceof CrudActionError) {
      redirect(providerWalletPath(providerId, 'reactivate_failed'))
    }
    throw error
  }
}
