import { describe, expect, it, vi } from 'vitest'
import { resolveVodapayCustomer } from '@/lib/vodapay/identity'

type MockDb = Parameters<typeof resolveVodapayCustomer>[0]['db']

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    customerExternalIdentity: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: unknown }) => args.data),
    },
    customer: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'cust_new' })),
    },
    ...overrides,
  } as unknown as MockDb
}

function identityCreateMock(db: MockDb) {
  return (db as unknown as {
    customerExternalIdentity: { create: ReturnType<typeof vi.fn> }
  }).customerExternalIdentity.create
}

function customerCreateMock(db: MockDb) {
  return (db as unknown as { customer: { create: ReturnType<typeof vi.fn> } }).customer.create
}

describe('resolveVodapayCustomer', () => {
  it('existing identity short-circuits', async () => {
    const db = mockDb({
      customerExternalIdentity: {
        findUnique: vi.fn(async () => ({ customerId: 'cust_1' })),
        create: vi.fn(),
      },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u1', phone: '+27821234567' })
    expect(out).toEqual({ customerId: 'cust_1', created: false })
    expect(identityCreateMock(db)).not.toHaveBeenCalled()
    expect(customerCreateMock(db)).not.toHaveBeenCalled()
  })

  it('looks the identity up on the composite unique key', async () => {
    const db = mockDb()
    await resolveVodapayCustomer({ db }, { externalId: 'u1', phone: '+27821234567' })
    const findUnique = (db as unknown as {
      customerExternalIdentity: { findUnique: ReturnType<typeof vi.fn> }
    }).customerExternalIdentity.findUnique
    expect(findUnique).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'VODAPAY', externalId: 'u1' } },
      select: { customerId: true },
    })
  })

  it('phone match links identity', async () => {
    const db = mockDb({
      customer: { findFirst: vi.fn(async () => ({ id: 'cust_p' })), create: vi.fn() },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u2', phone: '+27821234567' })
    expect(out).toEqual({ customerId: 'cust_p', created: false })
    expect(identityCreateMock(db)).toHaveBeenCalledWith({
      data: { customerId: 'cust_p', provider: 'VODAPAY', externalId: 'u2' },
    })
    expect(customerCreateMock(db)).not.toHaveBeenCalled()
  })

  it('no match creates customer + identity', async () => {
    const db = mockDb()
    const out = await resolveVodapayCustomer(
      { db },
      { externalId: 'u3', phone: '+27829999999', fullName: 'Thabo M' },
    )
    expect(out).toEqual({ customerId: 'cust_new', created: true })
    expect(customerCreateMock(db)).toHaveBeenCalledWith({
      data: { phone: '+27829999999', name: 'Thabo M', channel: 'PWA' },
      select: { id: true },
    })
    expect(identityCreateMock(db)).toHaveBeenCalledWith({
      data: { customerId: 'cust_new', provider: 'VODAPAY', externalId: 'u3' },
    })
  })

  it('falls back to a placeholder name when VodaPay returns none (Customer.name is required)', async () => {
    const db = mockDb()
    await resolveVodapayCustomer({ db }, { externalId: 'u4', phone: '+27829999999', fullName: '  ' })
    expect(customerCreateMock(db)).toHaveBeenCalledWith({
      data: { phone: '+27829999999', name: 'VodaPay Customer', channel: 'PWA' },
      select: { id: true },
    })
  })
})
