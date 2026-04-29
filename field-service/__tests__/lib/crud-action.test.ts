import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { CrudActionError, crudAction, meetsRoleRequirement } from '../../lib/crud-action'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('../../lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    adminAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../lib/flags', () => ({
  isEnabled: vi.fn(),
}))

import { getSession } from '../../lib/auth'
import { db } from '../../lib/db'
import { isEnabled } from '../../lib/flags'

const mockGetSession = vi.mocked(getSession)
const mockAdminUserFindUnique = vi.mocked(db.adminUser.findUnique)
const mockTransaction = vi.mocked(db.$transaction)
const mockIsEnabled = vi.mocked(isEnabled)

const ADMIN_SESSION = { id: 'supabase-user-1', email: 'admin@test.com', phone: null, role: 'admin' as const }
const OPS_ADMIN_USER = { id: 'admin-user-cuid-1', role: 'OPS' as const, active: true } as any
const ADMIN_ADMIN_USER = { id: 'admin-user-cuid-2', role: 'ADMIN' as const, active: true } as any

const testSchema = z.object({ name: z.string().min(1, 'Name required') })

const baseOpts = {
  entity: 'Location',
  action: 'location.create',
  requiredRole: ['ADMIN' as const],
  schema: testSchema,
  input: { name: 'Sandton' },
  run: vi.fn().mockResolvedValue({ id: 'loc-1', name: 'Sandton' }),
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: transaction passes through to callback
  ;(mockTransaction as any).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const mockTx = {
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
    }
    return fn(mockTx)
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('crudAction', () => {
  describe('role requirements', () => {
    it('supports explicit role exclusions on top of hierarchy checks', () => {
      const reconcileRoles = ['OPS', 'FINANCE', 'ADMIN', 'OWNER'] as const

      expect(meetsRoleRequirement('TRUST', [...reconcileRoles])).toBe(true)
      expect(meetsRoleRequirement('TRUST', [...reconcileRoles], ['TRUST'])).toBe(false)
      expect(meetsRoleRequirement('TRUST', ['ADMIN', 'OWNER'])).toBe(false)
      expect(meetsRoleRequirement('OPS', ['ADMIN', 'OWNER'])).toBe(false)
      expect(meetsRoleRequirement('FINANCE', [...reconcileRoles], ['TRUST'])).toBe(true)
    })
  })

  describe('unauthenticated', () => {
    it('throws UNAUTHENTICATED when session is null', async () => {
      mockGetSession.mockResolvedValue(null)
      await expect(crudAction({ ...baseOpts })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    })
  })

  describe('wrong role', () => {
    it('throws UNAUTHORIZED when actor has OPS role but ADMIN is required', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(OPS_ADMIN_USER)
      await expect(crudAction({ ...baseOpts, requiredRole: ['ADMIN'] })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })

    it('throws UNAUTHORIZED when no active AdminUser row exists', async () => {
      mockGetSession.mockResolvedValue({ ...ADMIN_SESSION, role: 'provider' })
      mockAdminUserFindUnique.mockResolvedValue(null)
      await expect(crudAction({ ...baseOpts })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })

    it('allows access when AdminUser row meets required role', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(ADMIN_ADMIN_USER)
      const result = await crudAction({ ...baseOpts, requiredRole: ['ADMIN'] })
      expect(result.ok).toBe(true)
    })

    it('throws UNAUTHORIZED when actor is explicitly excluded', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue({
        id: 'admin-user-cuid-trust',
        role: 'TRUST',
        active: true,
      } as any)
      await expect(
        crudAction({
          ...baseOpts,
          requiredRole: ['OPS', 'FINANCE', 'ADMIN', 'OWNER'],
          excludedRole: ['TRUST'],
        }),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })

    it('rejects legacy admin metadata when no AdminUser row exists', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(null)
      await expect(crudAction({ ...baseOpts, requiredRole: ['ADMIN'] })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })

  describe('feature flag disabled', () => {
    it('throws FLAG_DISABLED when flag is off', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(ADMIN_ADMIN_USER)
      mockIsEnabled.mockResolvedValue(false)
      await expect(
        crudAction({ ...baseOpts, requiredFlag: 'admin.crud.locations' })
      ).rejects.toMatchObject({ code: 'FLAG_DISABLED' })
    })

    it('proceeds when flag is on', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(ADMIN_ADMIN_USER)
      mockIsEnabled.mockResolvedValue(true)
      const result = await crudAction({ ...baseOpts, requiredFlag: 'admin.crud.locations' })
      expect(result.ok).toBe(true)
    })
  })

  describe('validation', () => {
    it('throws VALIDATION when input fails schema', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(ADMIN_ADMIN_USER)
      await expect(
        crudAction({ ...baseOpts, input: { name: '' } })
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    })
  })

  describe('happy path', () => {
    it('returns { ok: true, data } and writes audit rows in transaction', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue(ADMIN_ADMIN_USER)

      let auditLogCreated = false
      let adminAuditCreated = false

      ;(mockTransaction as any).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          auditLog: { create: vi.fn().mockImplementation(() => { auditLogCreated = true }) },
          adminAuditEvent: { create: vi.fn().mockImplementation(() => { adminAuditCreated = true }) },
        }
        return fn(mockTx)
      })

      const run = vi.fn().mockResolvedValue({ id: 'loc-1', name: 'Sandton' })
      const result = await crudAction({ ...baseOpts, run })

      expect(result).toEqual({ ok: true, data: { id: 'loc-1', name: 'Sandton' } })
      expect(run).toHaveBeenCalledOnce()
      expect(auditLogCreated).toBe(true)
      expect(adminAuditCreated).toBe(true)
    })

    it('rejects inactive AdminUser rows', async () => {
      mockGetSession.mockResolvedValue(ADMIN_SESSION)
      mockAdminUserFindUnique.mockResolvedValue({
        id: 'admin-user-cuid-3',
        role: 'OWNER',
        active: false,
      } as any)

      await expect(crudAction({ ...baseOpts })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      })
    })
  })
})
