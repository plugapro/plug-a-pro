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

describe('lead unlock dispute admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
})
