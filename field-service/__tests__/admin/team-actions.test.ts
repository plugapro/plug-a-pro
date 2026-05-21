import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockAdminUserFindUnique,
  mockAdminUserCount,
  mockAdminUserUpdate,
  mockAdminUserCreate,
  mockRequireRole,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockAdminUserFindUnique: vi.fn(),
  mockAdminUserCount: vi.fn(),
  mockAdminUserUpdate: vi.fn(),
  mockAdminUserCreate: vi.fn(),
  mockRequireRole: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

const mockTx = {
  adminUser: {
    findUnique: mockAdminUserFindUnique,
    count: mockAdminUserCount,
    update: mockAdminUserUpdate,
    create: mockAdminUserCreate,
  },
}

// Transparent pass-through: validates input via schema, calls run(data, mockTx),
// re-throws any error from run so guard assertions propagate correctly.
vi.mock('@/lib/crud-action', () => ({
  crudAction: async ({ run, schema, input }: any) => { // any: CrudActionOptions generics are not needed in the test double
    // Note: uses schema.parse (throwing) not safeParse; guard tests don't exercise schema validation paths
    const data = schema ? schema.parse(input) : input
    const result = await run(data, mockTx)
    return { ok: true as const, data: result }
  },
  CrudActionError: class CrudActionError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.code = code
      this.name = 'CrudActionError'
    }
  },
}))

vi.mock('@/lib/auth', () => ({
  requireRole: mockRequireRole,
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: null }) },
    },
  })),
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTOR = {
  id: 'actor-supabase-id',
  adminUserId: 'actor-admin-id',
  role: 'OWNER',
}

const OWNER_RECORD = {
  id: 'target-admin-id',
  role: 'OWNER',
  userId: 'different-user-id',
  active: true,
}

const NON_OWNER_RECORD = {
  id: 'target-admin-id',
  role: 'OPS',
  userId: 'different-user-id',
  active: true,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Assert a CrudActionError with the expected code and message pattern. */
async function expectCrudError(
  promise: Promise<unknown>,
  code: string,
  messagePattern: RegExp,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'CrudActionError',
    code,
    message: expect.stringMatching(messagePattern),
  })
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireRole.mockResolvedValue(ACTOR)
  // Default update succeeds
  mockAdminUserUpdate.mockResolvedValue({ id: 'target-admin-id' })
})

// ─── changeRoleAction ─────────────────────────────────────────────────────────

describe('changeRoleAction', () => {
  it('allows demoting an OWNER when 2+ active OWNERs exist', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(OWNER_RECORD)
    mockAdminUserCount.mockResolvedValue(2)

    const result = await changeRoleAction({
      adminUserId: 'target-admin-id',
      role: 'ADMIN',
    })

    expect(result.ok).toBe(true)
    expect(mockAdminUserCount).toHaveBeenCalledOnce()
    expect(mockAdminUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target-admin-id' }, data: { role: 'ADMIN' } }),
    )
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/team')
  })

  it('blocks demoting the last OWNER', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(OWNER_RECORD)
    mockAdminUserCount.mockResolvedValue(1)

    await expectCrudError(
      changeRoleAction({ adminUserId: 'target-admin-id', role: 'ADMIN' }),
      'CONFLICT',
      /last OWNER/,
    )
  })

  it('does not run the owner count check when target is non-OWNER', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(NON_OWNER_RECORD)

    const result = await changeRoleAction({
      adminUserId: 'target-admin-id',
      role: 'ADMIN',
    })

    expect(result.ok).toBe(true)
    expect(mockAdminUserCount).not.toHaveBeenCalled()
  })

  it('blocks self-role-change via userId match', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')
    // target.userId === actor.id → self-change by supabase ID
    mockAdminUserFindUnique.mockResolvedValue({
      ...OWNER_RECORD,
      userId: ACTOR.id,
    })

    await expectCrudError(
      changeRoleAction({ adminUserId: 'target-admin-id', role: 'ADMIN' }),
      'CONFLICT',
      /own role/,
    )
  })

  it('blocks self-role-change via adminUserId match', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')
    // target.id === actor.adminUserId → self-change by admin row ID
    mockAdminUserFindUnique.mockResolvedValue({
      ...OWNER_RECORD,
      id: ACTOR.adminUserId,
      userId: 'some-other-supabase-id',
    })

    await expectCrudError(
      changeRoleAction({ adminUserId: ACTOR.adminUserId, role: 'ADMIN' }),
      'CONFLICT',
      /own role/,
    )
  })

  it('throws NOT_FOUND when adminUser is null', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(null)

    await expectCrudError(
      changeRoleAction({ adminUserId: 'nonexistent-id', role: 'ADMIN' }),
      'NOT_FOUND',
      /not found/i,
    )
  })
})

// ─── deactivateAdminAction ────────────────────────────────────────────────────

describe('deactivateAdminAction', () => {
  it('allows deactivating an OWNER when 2+ active OWNERs exist', async () => {
    const { deactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(OWNER_RECORD)
    mockAdminUserCount.mockResolvedValue(2)

    const result = await deactivateAdminAction({ adminUserId: 'target-admin-id' })

    expect(result.ok).toBe(true)
    expect(mockAdminUserCount).toHaveBeenCalledOnce()
    expect(mockAdminUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target-admin-id' }, data: { active: false } }),
    )
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/team')
  })

  it('blocks deactivating the last OWNER', async () => {
    const { deactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(OWNER_RECORD)
    mockAdminUserCount.mockResolvedValue(1)

    await expectCrudError(
      deactivateAdminAction({ adminUserId: 'target-admin-id' }),
      'CONFLICT',
      /last OWNER/,
    )
  })

  it('blocks self-deactivation via userId match', async () => {
    const { deactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue({
      ...OWNER_RECORD,
      userId: ACTOR.id,
    })

    await expectCrudError(
      deactivateAdminAction({ adminUserId: 'target-admin-id' }),
      'CONFLICT',
      /own account/,
    )
  })

  it('blocks self-deactivation via adminUserId match', async () => {
    const { deactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue({
      ...OWNER_RECORD,
      id: ACTOR.adminUserId,
      userId: 'some-other-supabase-id',
    })

    await expectCrudError(
      deactivateAdminAction({ adminUserId: ACTOR.adminUserId }),
      'CONFLICT',
      /own account/,
    )
  })

  it('throws NOT_FOUND when admin user does not exist', async () => {
    const { deactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(null)
    await expect(
      deactivateAdminAction({ adminUserId: 'ghost-id' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ─── revokeAdminAction ────────────────────────────────────────────────────────

describe('revokeAdminAction', () => {
  it('allows revoking an OWNER when 2+ active OWNERs exist', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue({ ...OWNER_RECORD, acceptedAt: new Date() })
    mockAdminUserCount.mockResolvedValue(2)

    const result = await revokeAdminAction({ adminUserId: 'target-admin-id' })

    expect(result.ok).toBe(true)
    expect(mockAdminUserCount).toHaveBeenCalledOnce()
    expect(mockAdminUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target-admin-id' }, data: { active: false } }),
    )
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/team')
  })

  it('blocks revoking the last OWNER', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(OWNER_RECORD)
    mockAdminUserCount.mockResolvedValue(1)

    await expectCrudError(
      revokeAdminAction({ adminUserId: 'target-admin-id' }),
      'CONFLICT',
      /last OWNER/,
    )
  })

  it('blocks self-revocation via userId match', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue({
      ...OWNER_RECORD,
      userId: ACTOR.id,
    })

    await expectCrudError(
      revokeAdminAction({ adminUserId: 'target-admin-id' }),
      'CONFLICT',
      /own account/,
    )
  })

  it('blocks self-revocation via adminUserId match', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue({
      ...OWNER_RECORD,
      id: ACTOR.adminUserId,
      userId: 'some-other-supabase-id',
    })

    await expectCrudError(
      revokeAdminAction({ adminUserId: ACTOR.adminUserId }),
      'CONFLICT',
      /own account/,
    )
  })

  it('throws NOT_FOUND when admin user does not exist', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')
    mockAdminUserFindUnique.mockResolvedValue(null)
    await expect(
      revokeAdminAction({ adminUserId: 'ghost-id' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
