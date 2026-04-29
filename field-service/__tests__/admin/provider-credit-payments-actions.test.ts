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
    paymentIntent: {
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

vi.mock('../../lib/provider-credit-reconciliation', () => ({
  ProviderCreditReconciliationError: class ProviderCreditReconciliationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'ProviderCreditReconciliationError'
    }
  },
  creditPaymentIntentInTransaction: vi.fn(),
  reconcilePaymentIntentInTransaction: vi.fn(),
}))

vi.mock('../../lib/provider-wallet', () => ({
  ProviderWalletError: class ProviderWalletError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'ProviderWalletError'
    }
  },
}))

vi.mock('../../lib/provider-wallet-notifications', () => ({
  notifyProviderPaymentCredited: vi.fn(),
}))

describe('provider credit payment admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function arrangeAdmin() {
    const { requireAdmin } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')

    ;(requireAdmin as any).mockResolvedValue({
      id: 'user-1',
      adminUserId: 'admin-1',
    })
    ;(db.paymentIntent.findUnique as any).mockResolvedValue({
      id: 'intent-1',
      status: 'MATCHED_ON_STATEMENT',
      adminNote: null,
    })
  }

  async function executeCrudActionWith(tx: unknown) {
    const { crudAction } = await import('../../lib/crud-action')
    ;(crudAction as any).mockImplementation(async (options: any) => ({
      ok: true,
      data: await options.run(options.input, tx),
    }))
  }

  it('rejects reconciliation when the caller is not an admin', async () => {
    const { requireAdmin } = await import('../../lib/auth')
    const { crudAction } = await import('../../lib/crud-action')
    ;(requireAdmin as any).mockRejectedValue(new Error('unauthorized'))

    const { reconcileTopUpIntentAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      reconcileTopUpIntentAction({
        paymentIntentId: 'intent-1',
        bankStatementReference: 'BANK-REF-1',
        statementAmountCents: 10_000,
      }),
    ).rejects.toThrow('unauthorized')

    expect(crudAction).not.toHaveBeenCalled()
  })

  it('checks auth before mark-failed and add-note audit reads', async () => {
    const { requireAdmin } = await import('../../lib/auth')
    const { db } = await import('../../lib/db')
    const { crudAction } = await import('../../lib/crud-action')
    ;(requireAdmin as any).mockRejectedValue(new Error('unauthorized'))

    const {
      addTopUpIntentNoteAction,
      failTopUpIntentAction,
    } = await import('../../app/(admin)/admin/provider-credit-payments/actions')

    await expect(
      failTopUpIntentAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Funds not received',
      }),
    ).rejects.toThrow('unauthorized')
    await expect(
      addTopUpIntentNoteAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Follow-up note',
      }),
    ).rejects.toThrow('unauthorized')

    expect(db.paymentIntent.findUnique).not.toHaveBeenCalled()
    expect(crudAction).not.toHaveBeenCalled()
  })

  it('emits the payment credited notification once after admin credit succeeds', async () => {
    await arrangeAdmin()
    const { creditPaymentIntentInTransaction } = await import('../../lib/provider-credit-reconciliation')
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    ;(creditPaymentIntentInTransaction as any).mockResolvedValue({
      intent: { id: 'intent-1', status: 'CREDITED' },
      ledgerEntries: [{ id: 'entry-1' }],
    })
    await executeCrudActionWith({})
    ;(notifyProviderPaymentCredited as any).mockResolvedValue(undefined)

    const { creditTopUpIntentAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      creditTopUpIntentAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Funds confirmed',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        id: 'intent-1',
        status: 'CREDITED',
        ledgerEntryId: 'entry-1',
      },
    })

    expect(creditPaymentIntentInTransaction).toHaveBeenCalledTimes(1)
    expect(notifyProviderPaymentCredited).toHaveBeenCalledTimes(1)
    expect(notifyProviderPaymentCredited).toHaveBeenCalledWith('intent-1')
  })

  it('maps duplicate credit attempts to an action conflict without notifying again', async () => {
    await arrangeAdmin()
    const { CrudActionError } = await import('../../lib/crud-action')
    const {
      ProviderCreditReconciliationError,
      creditPaymentIntentInTransaction,
    } = await import('../../lib/provider-credit-reconciliation')
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    ;(creditPaymentIntentInTransaction as any).mockRejectedValue(
      new ProviderCreditReconciliationError('ALREADY_CREDITED', 'This payment intent has already been credited.'),
    )
    await executeCrudActionWith({})

    const { creditTopUpIntentAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      creditTopUpIntentAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Duplicate click',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)

    expect(notifyProviderPaymentCredited).not.toHaveBeenCalled()
  })

  it('maps reconcile amount mismatch to an action conflict', async () => {
    await arrangeAdmin()
    const { CrudActionError } = await import('../../lib/crud-action')
    const {
      ProviderCreditReconciliationError,
      reconcilePaymentIntentInTransaction,
    } = await import('../../lib/provider-credit-reconciliation')

    ;(reconcilePaymentIntentInTransaction as any).mockRejectedValue(
      new ProviderCreditReconciliationError(
        'AMOUNT_MISMATCH',
        'Confirmed bank amount does not match the provider top-up intent.',
      ),
    )
    await executeCrudActionWith({})

    const { reconcileTopUpIntentAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      reconcileTopUpIntentAction({
        paymentIntentId: 'intent-1',
        bankStatementReference: 'BANK-REF-1',
        statementAmountCents: 5_000,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)
  })

  it('blocks marking a credited top-up as failed', async () => {
    const { CrudActionError } = await import('../../lib/crud-action')
    const tx = {
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intent-1',
          status: 'CREDITED',
          adminNote: 'Credited already',
        }),
        update: vi.fn(),
      },
    }
    await executeCrudActionWith(tx)

    const { failTopUpIntentAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      failTopUpIntentAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Funds not received',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)

    expect(tx.paymentIntent.update).not.toHaveBeenCalled()
  })

  it('adds an admin note without touching wallet crediting', async () => {
    const tx = {
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'intent-1',
          adminNote: 'Existing note',
        }),
        update: vi.fn().mockResolvedValue({
          id: 'intent-1',
          adminNote: 'Existing note\nFollow-up note',
        }),
      },
    }
    await executeCrudActionWith(tx)
    const { creditPaymentIntentInTransaction } = await import('../../lib/provider-credit-reconciliation')

    const { addTopUpIntentNoteAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      addTopUpIntentNoteAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Follow-up note',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { id: 'intent-1' },
    })

    expect(tx.paymentIntent.update).toHaveBeenCalledWith({
      where: { id: 'intent-1' },
      data: { adminNote: 'Existing note\nFollow-up note' },
    })
    expect(creditPaymentIntentInTransaction).not.toHaveBeenCalled()
  })

  it('keeps TRUST excluded from all manual EFT reconciliation actions', async () => {
    await arrangeAdmin()
    const { crudAction } = await import('../../lib/crud-action')
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')
    ;(crudAction as any).mockResolvedValue({ ok: true, data: { id: 'intent-1', status: 'noop' } })
    ;(notifyProviderPaymentCredited as any).mockResolvedValue(undefined)

    const {
      addTopUpIntentNoteAction,
      creditTopUpIntentAction,
      failTopUpIntentAction,
      reconcileTopUpIntentAction,
    } = await import('../../app/(admin)/admin/provider-credit-payments/actions')

    await reconcileTopUpIntentAction({
      paymentIntentId: 'intent-1',
      bankStatementReference: 'BANK-REF-1',
      statementAmountCents: 10_000,
    })
    await creditTopUpIntentAction({
      paymentIntentId: 'intent-1',
      adminNote: 'Funds confirmed',
    })
    await failTopUpIntentAction({
      paymentIntentId: 'intent-1',
      adminNote: 'Funds not received',
    })
    await addTopUpIntentNoteAction({
      paymentIntentId: 'intent-1',
      adminNote: 'Follow-up note',
    })

    for (const call of (crudAction as any).mock.calls) {
      expect(call[0]).toMatchObject({
        requiredFlag: 'admin.crud.payments',
      })
      expect(call[0].requiredRole).toEqual(['OPS', 'FINANCE', 'ADMIN', 'OWNER'])
      expect(call[0].excludedRole).toEqual(['TRUST'])
      expect(call[0].requiredRole).not.toContain('TRUST')
    }
  })

  it('maps suspended-wallet credit failures to action conflicts', async () => {
    await arrangeAdmin()
    const { creditPaymentIntentInTransaction } = await import('../../lib/provider-credit-reconciliation')
    const { ProviderWalletError } = await import('../../lib/provider-wallet')
    const { notifyProviderPaymentCredited } = await import('../../lib/provider-wallet-notifications')

    ;(creditPaymentIntentInTransaction as any).mockRejectedValue(
      new ProviderWalletError('WALLET_NOT_ACTIVE', 'Provider wallet is suspended.'),
    )
    await executeCrudActionWith({})
    ;(notifyProviderPaymentCredited as any).mockResolvedValue(undefined)

    const { creditTopUpIntentAction } = await import(
      '../../app/(admin)/admin/provider-credit-payments/actions'
    )

    await expect(
      creditTopUpIntentAction({
        paymentIntentId: 'intent-1',
        adminNote: 'Funds confirmed',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Provider wallet is suspended.',
    })

    expect(notifyProviderPaymentCredited).not.toHaveBeenCalled()
  })
})
