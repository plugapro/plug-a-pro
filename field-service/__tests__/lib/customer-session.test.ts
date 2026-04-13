import { describe, expect, it, vi } from 'vitest'

import { resolveCustomerForSession } from '@/lib/customer-session'

describe('resolveCustomerForSession', () => {
  it('falls back to phone and self-links the customer when userId lookup misses', async () => {
    const client = {
      customer: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'cust_1',
            userId: null,
            phone: '+27823035070',
            name: 'WhatsApp Customer',
            email: null,
          }),
        findFirst: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: 'cust_1',
          userId: 'user_1',
          phone: '+27823035070',
          name: 'WhatsApp Customer',
          email: null,
        }),
      },
    }

    const customer = await resolveCustomerForSession(client as never, {
      id: 'user_1',
      email: null,
      phone: '+27823035070',
      role: 'customer',
    })

    expect(client.customer.findUnique).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user_1' },
      select: {
        id: true,
        userId: true,
        phone: true,
        name: true,
        email: true,
      },
    })
    expect(client.customer.findUnique).toHaveBeenNthCalledWith(2, {
      where: { phone: '+27823035070' },
      select: {
        id: true,
        userId: true,
        phone: true,
        name: true,
        email: true,
      },
    })
    expect(client.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust_1' },
      data: { userId: 'user_1' },
      select: {
        id: true,
        userId: true,
        phone: true,
        name: true,
        email: true,
      },
    })
    expect(customer?.userId).toBe('user_1')
  })
})
