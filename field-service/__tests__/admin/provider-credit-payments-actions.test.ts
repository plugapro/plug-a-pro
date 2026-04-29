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

describe('provider credit payment admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
})
