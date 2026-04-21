import { describe, expect, it, vi } from 'vitest'
import { mergeCustomers, purgeArchivedCustomer } from '@/lib/customer-lifecycle'

function makeTx() {
  return {
    customer: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    address: { updateMany: vi.fn() },
    customerNote: { updateMany: vi.fn() },
    jobRequest: { count: vi.fn(), updateMany: vi.fn() },
    messageEvent: { updateMany: vi.fn() },
    whatsappPreferenceLog: { updateMany: vi.fn() },
    review: { updateMany: vi.fn() },
    customerMergeEvent: { create: vi.fn() },
  }
}

describe('customer lifecycle', () => {
  it('reparents customer-owned records to the merge target and schedules the source for purge', async () => {
    const tx = makeTx()
    tx.customer.findUnique
      .mockResolvedValueOnce({
        id: 'cust-source',
        userId: 'user-source',
        phone: '+271',
        email: 'source@example.com',
        name: 'Source',
        notes: 'source note',
        address: 'Source address',
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
        suspendedUntil: null,
        suspendedReason: null,
        marketingOptIn: false,
        serviceOptIn: true,
      })
      .mockResolvedValueOnce({
        id: 'cust-target',
        userId: null,
        phone: '+272',
        email: null,
        name: 'Target',
        notes: 'target note',
        address: null,
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
        suspendedUntil: null,
        suspendedReason: null,
        marketingOptIn: true,
        serviceOptIn: true,
      })

    const result = await mergeCustomers(tx as any, {
      sourceCustomerId: 'cust-source',
      targetCustomerId: 'cust-target',
      executedById: 'admin-1',
      reason: 'Duplicate customer records',
    })

    expect(result.id).toBe('cust-target')
    expect(result.mergedSourceId).toBe('cust-source')
    expect(tx.jobRequest.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-source' },
      data: { customerId: 'cust-target' },
    })
    expect(tx.messageEvent.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-source' },
      data: { customerId: 'cust-target' },
    })
    expect(tx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-source' },
        data: expect.objectContaining({
          active: false,
          mergedIntoCustomerId: 'cust-target',
          userId: null,
        }),
      }),
    )
    expect(tx.customerMergeEvent.create).toHaveBeenCalled()
  })

  it('refuses to merge customers linked to different authenticated accounts', async () => {
    const tx = makeTx()
    tx.customer.findUnique
      .mockResolvedValueOnce({
        id: 'cust-source',
        userId: 'user-source',
        phone: '+271',
        email: null,
        name: 'Source',
        notes: null,
        address: null,
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
        suspendedUntil: null,
        suspendedReason: null,
        marketingOptIn: false,
        serviceOptIn: true,
      })
      .mockResolvedValueOnce({
        id: 'cust-target',
        userId: 'user-target',
        phone: '+272',
        email: null,
        name: 'Target',
        notes: null,
        address: null,
        isBlocked: false,
        blockedReason: null,
        blockedAt: null,
        suspendedUntil: null,
        suspendedReason: null,
        marketingOptIn: false,
        serviceOptIn: true,
      })

    await expect(
      mergeCustomers(tx as any, {
        sourceCustomerId: 'cust-source',
        targetCustomerId: 'cust-target',
        executedById: 'admin-1',
        reason: 'Duplicate',
      }),
    ).rejects.toThrow('Cannot merge customers that are linked to different authenticated accounts.')
  })

  it('refuses purge while job requests still reference the archived customer', async () => {
    const tx = makeTx()
    tx.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      archivedAt: new Date('2026-03-01T00:00:00.000Z'),
      purgeAfter: new Date('2026-03-31T00:00:00.000Z'),
    })
    tx.jobRequest.count.mockResolvedValue(2)

    await expect(
      purgeArchivedCustomer(tx as any, {
        customerId: 'cust-1',
      }),
    ).rejects.toThrow('Customer cannot be purged while job requests still reference the record.')
  })
})
