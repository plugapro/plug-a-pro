import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockRequireRole, mockRequireRoleApi, mockIsEnabled, mockFindMany } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockRequireRole: vi.fn(),
  mockRequireRoleApi: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: mockRequireAdmin,
  requireRole: mockRequireRole,
  requireRoleApi: mockRequireRoleApi,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/db', () => ({
  db: {
    customer: {
      findMany: mockFindMany,
    },
    adminAuditEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

describe('GET /api/admin/customers/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ id: 'supabase-admin-1', adminUserId: 'admin-1', adminRole: 'ADMIN' })
    mockRequireRole.mockResolvedValue({ id: 'supabase-admin-1', adminUserId: 'admin-1', adminRole: 'ADMIN' })
    mockRequireRoleApi.mockResolvedValue({ id: 'supabase-admin-1', adminUserId: 'admin-1', adminRole: 'ADMIN' })
    mockIsEnabled.mockResolvedValue(true)
    mockFindMany.mockResolvedValue([])
  })

  it('passes the search term into Prisma filters instead of interpolating raw SQL', async () => {
    const { GET } = await import('@/app/api/admin/customers/export/route')

    const response = await GET(
      new Request('http://localhost/api/admin/customers/export?q=%27%20OR%201%3D1&blocked=true')
    )

    expect(response.status).toBe(200)
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isBlocked: true,
          OR: expect.arrayContaining([
            expect.objectContaining({
              name: expect.objectContaining({
                contains: "' OR 1=1",
              }),
            }),
          ]),
        }),
      })
    )
  })
})
