import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const { mockGetCustomerSession, mockResolveCustomerForSession, mockDb } = vi.hoisted(() => {
  const mockDb = {
    customer: { findUnique: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockDb),
    ),
  }
  return {
    mockDb,
    mockGetCustomerSession: vi.fn(),
    mockResolveCustomerForSession: vi.fn(),
  }
})

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/auth', () => ({ getCustomerSession: mockGetCustomerSession }))
vi.mock('@/lib/customer-session', () => ({
  resolveCustomerForSession: mockResolveCustomerForSession,
}))

import { customerAction, CustomerActionError } from '@/lib/customer-action'

const mockCustomer = { id: 'cust-1', userId: 'user-1' }
// AuthUser has id at the top level (not nested under .user)
const mockSession = { id: 'user-1', email: null, phone: null, role: 'customer' as const }

describe('customerAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCustomerSession.mockResolvedValue(mockSession)
    mockResolveCustomerForSession.mockResolvedValue(mockCustomer)
  })

  it('runs the mutation and writes an AuditLog row', async () => {
    const run = vi.fn().mockResolvedValue({ id: 'cust-1', isBusinessAccount: true })

    await customerAction({
      entity: 'Customer',
      action: 'update_account_type',
      schema: z.object({ type: z.enum(['personal', 'business']) }),
      input: { type: 'business' },
      run,
    })

    expect(run).toHaveBeenCalledWith(
      { type: 'business' },
      mockCustomer,
      expect.anything(),
    )
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'user-1',
          actorRole: 'CUSTOMER',
          entityType: 'Customer',
          entityId: 'cust-1',
          action: 'update_account_type',
        }),
      }),
    )
  })

  it('throws when the session is missing', async () => {
    mockGetCustomerSession.mockResolvedValueOnce(null)
    await expect(
      customerAction({
        entity: 'Customer',
        action: 'update_account_type',
        run: vi.fn(),
      }),
    ).rejects.toThrow(CustomerActionError)
  })

  it('throws when customer record is not found', async () => {
    mockResolveCustomerForSession.mockResolvedValueOnce(null)
    await expect(
      customerAction({
        entity: 'Customer',
        action: 'update_account_type',
        run: vi.fn(),
      }),
    ).rejects.toThrow(CustomerActionError)
  })

  it('throws when validation fails', async () => {
    await expect(
      customerAction({
        entity: 'Customer',
        action: 'update_account_type',
        schema: z.object({ type: z.enum(['personal', 'business']) }),
        input: { type: 'INVALID' },
        run: vi.fn(),
      }),
    ).rejects.toThrow(CustomerActionError)
  })

  it('throws when customer is blocked', async () => {
    mockResolveCustomerForSession.mockResolvedValueOnce({ id: 'cust-1', userId: 'user-1', isBlocked: true })
    await expect(
      customerAction({ entity: 'Customer', action: 'test', run: vi.fn() }),
    ).rejects.toThrow(CustomerActionError)
  })

  it('returns { ok: true, data } on success', async () => {
    const run = vi.fn().mockResolvedValue({ id: 'cust-1' })
    const result = await customerAction({
      entity: 'Customer',
      action: 'update_account_type',
      run,
    })
    expect(result).toEqual({ ok: true, data: { id: 'cust-1' } })
  })
})
