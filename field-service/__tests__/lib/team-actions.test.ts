import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireRole,
  mockInviteUserByEmail,
  mockCrudAction,
  mockAdminUserFindUnique,
  mockAdminUserUpdate,
  mockAdminUserCreate,
  mockAdminUserCount,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockInviteUserByEmail: vi.fn(),
  mockCrudAction: vi.fn(),
  mockAdminUserFindUnique: vi.fn(),
  mockAdminUserUpdate: vi.fn(),
  mockAdminUserCreate: vi.fn(),
  mockAdminUserCount: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('@/lib/auth', () => ({
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        inviteUserByEmail: mockInviteUserByEmail,
      },
    },
  })),
  requireRole: mockRequireRole,
}))

class MockCrudActionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CrudActionError'
    this.code = code
  }
}

vi.mock('@/lib/crud-action', () => ({
  CrudActionError: MockCrudActionError,
  crudAction: mockCrudAction,
}))

beforeEach(() => {
  vi.clearAllMocks()

  mockRequireRole.mockResolvedValue({
    id: 'supabase-owner-1',
    email: 'owner@plugapro.co.za',
    phone: null,
    role: 'owner',
    adminRole: 'OWNER',
    adminUserId: 'admin-owner-1',
  })

  mockCrudAction.mockImplementation(async (opts: {
    input: unknown
    run: (input: unknown, tx: {
      adminUser: {
        findUnique: typeof mockAdminUserFindUnique
        update: typeof mockAdminUserUpdate
        create: typeof mockAdminUserCreate
        count: typeof mockAdminUserCount
      }
    }) => Promise<unknown>
  }) => {
    const tx = {
      adminUser: {
        findUnique: mockAdminUserFindUnique,
        update: mockAdminUserUpdate,
        create: mockAdminUserCreate,
        count: mockAdminUserCount,
      },
    }

    return { ok: true as const, data: await opts.run(opts.input, tx) }
  })
})

describe('team admin actions', () => {
  it('refuses to remove the last OWNER role', async () => {
    const { changeRoleAction } = await import('@/app/(admin)/admin/team/actions')

    mockAdminUserFindUnique.mockResolvedValue({
      id: 'admin-owner-2',
      role: 'OWNER',
      userId: 'supabase-owner-2',
      active: true,
    })
    mockAdminUserCount.mockResolvedValue(1)

    await expect(
      changeRoleAction({ adminUserId: 'admin-owner-2', role: 'ADMIN' })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'You cannot remove the last OWNER role.',
    })

    expect(mockAdminUserUpdate).not.toHaveBeenCalled()
  })

  it('refuses to deactivate the caller', async () => {
    const { deactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')

    mockAdminUserFindUnique.mockResolvedValue({
      id: 'admin-owner-1',
      role: 'OWNER',
      userId: 'supabase-owner-1',
      active: true,
    })

    await expect(
      deactivateAdminAction({ adminUserId: 'admin-owner-1' })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'You cannot deactivate your own account.',
    })

    expect(mockAdminUserCount).not.toHaveBeenCalled()
    expect(mockAdminUserUpdate).not.toHaveBeenCalled()
  })

  it('reactivates an inactive admin account', async () => {
    const { reactivateAdminAction } = await import('@/app/(admin)/admin/team/actions')

    mockAdminUserFindUnique.mockResolvedValue({
      id: 'admin-ops-1',
      active: false,
      acceptedAt: null,
    })
    mockAdminUserUpdate.mockResolvedValue({
      id: 'admin-ops-1',
    })

    await expect(
      reactivateAdminAction({ adminUserId: 'admin-ops-1' })
    ).resolves.toMatchObject({
      ok: true,
      data: { id: 'admin-ops-1' },
    })

    expect(mockAdminUserUpdate).toHaveBeenCalledWith({
      where: { id: 'admin-ops-1' },
      data: { active: true },
    })
  })

  it('refuses to revoke the caller', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')

    mockAdminUserFindUnique.mockResolvedValue({
      id: 'admin-owner-1',
      role: 'OWNER',
      userId: 'supabase-owner-1',
      active: true,
      acceptedAt: null,
    })

    await expect(
      revokeAdminAction({ adminUserId: 'admin-owner-1' })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'You cannot revoke your own account.',
    })

    expect(mockAdminUserCount).not.toHaveBeenCalled()
    expect(mockAdminUserUpdate).not.toHaveBeenCalled()
  })

  it('revokes a pending invite by disabling the admin row', async () => {
    const { revokeAdminAction } = await import('@/app/(admin)/admin/team/actions')

    mockAdminUserFindUnique.mockResolvedValue({
      id: 'admin-pending-1',
      role: 'OPS',
      userId: 'pending:ops@plugapro.co.za',
      active: true,
      acceptedAt: null,
    })
    mockAdminUserUpdate.mockResolvedValue({
      id: 'admin-pending-1',
    })

    await expect(
      revokeAdminAction({ adminUserId: 'admin-pending-1' })
    ).resolves.toMatchObject({
      ok: true,
      data: { id: 'admin-pending-1' },
    })

    expect(mockAdminUserUpdate).toHaveBeenCalledWith({
      where: { id: 'admin-pending-1' },
      data: { active: false },
    })
  })
})
