import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('../../lib/auth', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    providerWallet: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../../lib/crud-action', () => ({
  CrudActionError: class CrudActionError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'CrudActionError'
    }
  },
  crudAction: vi.fn(),
}))

vi.mock('../../lib/provider-wallet', () => ({
  ProviderWalletError: class ProviderWalletError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'ProviderWalletError'
    }
  },
  adjustProviderCreditsInTransaction: vi.fn(),
  suspendProviderWalletInTransaction: vi.fn(),
  reactivateProviderWalletInTransaction: vi.fn(),
}))

describe('provider wallet admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects wallet adjustments when the caller is not an admin', async () => {
    const { requireAdmin } = await import('../../lib/auth')
    const { crudAction } = await import('../../lib/crud-action')
    ;(requireAdmin as any).mockRejectedValue(new Error('unauthorized'))

    const { adjustProviderCreditsAction } = await import(
      '../../app/(admin)/admin/provider-wallets/actions'
    )

    await expect(
      adjustProviderCreditsAction({
        providerId: 'provider-1',
        creditType: 'PAID',
        amountCredits: 5,
        reason: 'Pilot correction',
        confirmAdjustment: true,
      }),
    ).rejects.toThrow('unauthorized')

    expect(crudAction).not.toHaveBeenCalled()
  })

  it('wraps adjustments in an audited OPS-level crud action', async () => {
    const { requireAdmin } = await import('../../lib/auth')
    const { crudAction } = await import('../../lib/crud-action')
    const { db } = await import('../../lib/db')
    ;(requireAdmin as any).mockResolvedValue({
      id: 'supabase-admin-1',
      adminUserId: 'admin-1',
    })
    ;(db.providerWallet.findUnique as any).mockResolvedValue({
      id: 'wallet-1',
      providerId: 'provider-1',
      paidCreditBalance: 2,
      promoCreditBalance: 1,
      status: 'ACTIVE',
    })
    ;(crudAction as any).mockResolvedValue({ ok: true, data: { walletId: 'wallet-1' } })

    const { adjustProviderCreditsAction } = await import(
      '../../app/(admin)/admin/provider-wallets/actions'
    )

    await adjustProviderCreditsAction({
      providerId: 'provider-1',
      creditType: 'PAID',
      amountCredits: -1,
      reason: 'Reversal after ops review',
      confirmAdjustment: true,
    })

    expect(crudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'provider_wallet.admin_adjustment',
      entity: 'ProviderWallet',
      entityId: 'wallet-1',
      requiredRole: ['OPS'],
      reason: 'Reversal after ops review',
    }))
  })
})
