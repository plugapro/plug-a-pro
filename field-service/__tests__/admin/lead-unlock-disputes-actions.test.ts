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
    leadUnlockDispute: {
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

vi.mock('../../lib/lead-unlock-disputes', () => ({
  LeadUnlockDisputeError: class LeadUnlockDisputeError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'LeadUnlockDisputeError'
    }
  },
  approveLeadUnlockDisputeInTransaction: vi.fn(),
  rejectLeadUnlockDisputeInTransaction: vi.fn(),
}))

vi.mock('../../lib/provider-wallet', () => ({
  ProviderWalletError: class ProviderWalletError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'ProviderWalletError'
    }
  },
}))

describe('lead unlock dispute admin actions', () => {
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
    ;(db.leadUnlockDispute.findUnique as any).mockResolvedValue({
      id: 'dispute-1',
      status: 'OPEN',
    })
  }

  async function executeCrudActionWith(tx: unknown) {
    const { crudAction } = await import('../../lib/crud-action')
    ;(crudAction as any).mockImplementation(async (options: any) => {
      if (options.schema) {
        const parsed = options.schema.safeParse(options.input)
        if (!parsed.success) {
          throw new (await import('../../lib/crud-action')).CrudActionError(
            'VALIDATION',
            parsed.error.issues.map((issue: any) => issue.message).join('; '),
          )
        }
      }
      return {
        ok: true,
        data: await options.run(options.input, tx),
      }
    })
  }

  it('rejects dispute approval when the caller is not an admin', async () => {
    const { requireAdmin } = await import('../../lib/auth')
    const { crudAction } = await import('../../lib/crud-action')
    ;(requireAdmin as any).mockRejectedValue(new Error('unauthorized'))

    const { approveLeadUnlockDisputeAction } = await import(
      '../../app/(admin)/admin/lead-unlock-disputes/actions'
    )

    await expect(
      approveLeadUnlockDisputeAction({
        disputeId: 'dispute-1',
        adminNotes: 'Invalid number confirmed',
      }),
    ).rejects.toThrow('unauthorized')

    expect(crudAction).not.toHaveBeenCalled()
  })

  it('approves a dispute through crudAction and returns refund ledger ids', async () => {
    await arrangeAdmin()
    await executeCrudActionWith({})
    const { approveLeadUnlockDisputeInTransaction } = await import('../../lib/lead-unlock-disputes')

    ;(approveLeadUnlockDisputeInTransaction as any).mockResolvedValue({
      dispute: { id: 'dispute-1', status: 'APPROVED' },
      ledgerEntries: [{ id: 'refund-entry-1' }, { id: 'refund-entry-2' }],
    })

    const { approveLeadUnlockDisputeAction } = await import(
      '../../app/(admin)/admin/lead-unlock-disputes/actions'
    )

    await expect(
      approveLeadUnlockDisputeAction({
        disputeId: 'dispute-1',
        adminNotes: 'Invalid number confirmed',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        id: 'dispute-1',
        status: 'APPROVED',
        ledgerEntryIds: ['refund-entry-1', 'refund-entry-2'],
      },
    })

    expect(approveLeadUnlockDisputeInTransaction).toHaveBeenCalledWith(
      {},
      'dispute-1',
      'admin-1',
      'Invalid number confirmed',
    )
  })

  it('maps duplicate approval to an action conflict', async () => {
    await arrangeAdmin()
    await executeCrudActionWith({})
    const { CrudActionError } = await import('../../lib/crud-action')
    const {
      LeadUnlockDisputeError,
      approveLeadUnlockDisputeInTransaction,
    } = await import('../../lib/lead-unlock-disputes')

    ;(approveLeadUnlockDisputeInTransaction as any).mockRejectedValue(
      new LeadUnlockDisputeError('ALREADY_REFUNDED', 'This lead unlock has already been refunded.'),
    )

    const { approveLeadUnlockDisputeAction } = await import(
      '../../app/(admin)/admin/lead-unlock-disputes/actions'
    )

    await expect(
      approveLeadUnlockDisputeAction({
        disputeId: 'dispute-1',
        adminNotes: 'Duplicate approval',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)
  })

  it('maps suspended-wallet refund failures to an action conflict', async () => {
    await arrangeAdmin()
    await executeCrudActionWith({})
    const { CrudActionError } = await import('../../lib/crud-action')
    const { approveLeadUnlockDisputeInTransaction } = await import('../../lib/lead-unlock-disputes')
    const { ProviderWalletError } = await import('../../lib/provider-wallet')

    ;(approveLeadUnlockDisputeInTransaction as any).mockRejectedValue(
      new ProviderWalletError('WALLET_NOT_ACTIVE', 'Provider wallet is suspended.'),
    )

    const { approveLeadUnlockDisputeAction } = await import(
      '../../app/(admin)/admin/lead-unlock-disputes/actions'
    )

    await expect(
      approveLeadUnlockDisputeAction({
        disputeId: 'dispute-1',
        adminNotes: 'Invalid number confirmed',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Provider wallet is suspended.',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)
  })

  it('rejects a dispute through crudAction without refund ledger entries', async () => {
    await arrangeAdmin()
    await executeCrudActionWith({})
    const { rejectLeadUnlockDisputeInTransaction } = await import('../../lib/lead-unlock-disputes')

    ;(rejectLeadUnlockDisputeInTransaction as any).mockResolvedValue({
      dispute: { id: 'dispute-1', status: 'REJECTED' },
      ledgerEntries: [],
    })

    const { rejectLeadUnlockDisputeAction } = await import(
      '../../app/(admin)/admin/lead-unlock-disputes/actions'
    )

    await expect(
      rejectLeadUnlockDisputeAction({
        disputeId: 'dispute-1',
        adminNotes: 'Lead was valid',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        id: 'dispute-1',
        status: 'REJECTED',
      },
    })

    expect(rejectLeadUnlockDisputeInTransaction).toHaveBeenCalledWith(
      {},
      'dispute-1',
      'admin-1',
      'Lead was valid',
    )
  })

  it('requires admin notes when rejecting a dispute', async () => {
    await arrangeAdmin()
    await executeCrudActionWith({})
    const { CrudActionError } = await import('../../lib/crud-action')
    const { rejectLeadUnlockDisputeInTransaction } = await import('../../lib/lead-unlock-disputes')

    const { rejectLeadUnlockDisputeAction } = await import(
      '../../app/(admin)/admin/lead-unlock-disputes/actions'
    )

    await expect(
      rejectLeadUnlockDisputeAction({
        disputeId: 'dispute-1',
        adminNotes: '',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)

    expect(rejectLeadUnlockDisputeInTransaction).not.toHaveBeenCalled()
  })

  it('allows TRUST role through the dispute action role set', async () => {
    await arrangeAdmin()
    const { crudAction } = await import('../../lib/crud-action')
    ;(crudAction as any).mockResolvedValue({
      ok: true,
      data: { id: 'dispute-1', status: 'noop', ledgerEntryIds: [] },
    })

    const {
      approveLeadUnlockDisputeAction,
      rejectLeadUnlockDisputeAction,
    } = await import('../../app/(admin)/admin/lead-unlock-disputes/actions')

    await approveLeadUnlockDisputeAction({
      disputeId: 'dispute-1',
      adminNotes: 'Invalid number confirmed',
    })
    await rejectLeadUnlockDisputeAction({
      disputeId: 'dispute-1',
      adminNotes: 'Lead was valid',
    })

    for (const call of (crudAction as any).mock.calls) {
      expect(call[0]).toMatchObject({
        requiredFlag: 'admin.crud.payments',
      })
      expect(call[0].requiredRole).toEqual(['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'])
    }
  })
})
