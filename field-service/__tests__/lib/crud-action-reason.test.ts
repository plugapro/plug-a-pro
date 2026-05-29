import { vi, it, expect, beforeEach } from 'vitest'

// Mock dependencies - crudAction imports db, auth, flags
vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    adminAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      adminUser: { findUnique: vi.fn() },
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))

import { crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'

const mockSession = { id: 'user-1' }
const mockAdmin = { id: 'admin-1', role: 'ADMIN', active: true }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)
  ;(db.adminUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdmin)
  ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
    const txMock = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      adminAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(txMock)
  })
})

it('includes reason in audit payload when provided', async () => {
  let capturedAuditData: Record<string, unknown> | undefined

  ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
    const txMock = {
      auditLog: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          capturedAuditData = args.data
          return {}
        }),
      },
      adminAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(txMock)
  })

  await crudAction({
    entity: 'Customer',
    entityId: 'cust-1',
    action: 'customer.block',
    requiredRole: ['OPS'],
    reason: 'Fraud detected',
    run: async () => ({ id: 'cust-1' }),
  })

  expect(capturedAuditData?.reason).toBe('Fraud detected')
})
