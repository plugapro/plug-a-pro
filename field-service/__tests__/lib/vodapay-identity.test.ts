import { describe, expect, it, vi } from 'vitest'
import {
  findVodapayAuthUserByPhone,
  resolveVodapayAuthUser,
  resolveVodapayCustomer,
  vodapayAuthEmail,
} from '@/lib/vodapay/identity'

type MockDb = Parameters<typeof resolveVodapayCustomer>[0]['db']

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    customerExternalIdentity: {
      findUnique: vi.fn(async () => null),
      // upsert echoes the row it would have created (the no-race case).
      upsert: vi.fn(async (args: { create: { customerId: string } }) => ({
        customerId: args.create.customerId,
      })),
    },
    customer: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'cust_new' })),
    },
    ...overrides,
  } as unknown as MockDb
}

function identityUpsertMock(db: MockDb) {
  return (db as unknown as {
    customerExternalIdentity: { upsert: ReturnType<typeof vi.fn> }
  }).customerExternalIdentity.upsert
}

function customerCreateMock(db: MockDb) {
  return (db as unknown as { customer: { create: ReturnType<typeof vi.fn> } }).customer.create
}

function uniqueViolation() {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
}

describe('resolveVodapayCustomer', () => {
  it('existing identity short-circuits', async () => {
    const db = mockDb({
      customerExternalIdentity: {
        findUnique: vi.fn(async () => ({ customerId: 'cust_1' })),
        upsert: vi.fn(),
      },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u1', phone: '+27821234567' })
    expect(out).toEqual({ customerId: 'cust_1', created: false })
    expect(identityUpsertMock(db)).not.toHaveBeenCalled()
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
    expect(identityUpsertMock(db)).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'VODAPAY', externalId: 'u2' } },
      create: { customerId: 'cust_p', provider: 'VODAPAY', externalId: 'u2' },
      update: {},
      select: { customerId: true },
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
  })

  it('falls back to a placeholder name when VodaPay returns none (Customer.name is required)', async () => {
    const db = mockDb()
    await resolveVodapayCustomer({ db }, { externalId: 'u4', phone: '+27829999999', fullName: '  ' })
    expect(customerCreateMock(db)).toHaveBeenCalledWith({
      data: { phone: '+27829999999', name: 'VodaPay Customer', channel: 'PWA' },
      select: { id: true },
    })
  })

  it('converges on the winner when a concurrent login created the customer first (P2002)', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // our read: not there yet
      .mockResolvedValueOnce({ id: 'cust_race' }) // after the losing create
    const db = mockDb({
      customer: { findFirst, create: vi.fn(async () => { throw uniqueViolation() }) },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u5', phone: '+27829999999' })
    expect(out).toEqual({ customerId: 'cust_race', created: false })
    expect(identityUpsertMock(db)).toHaveBeenCalled()
  })

  it('rethrows a non-unique-constraint failure from customer.create', async () => {
    const db = mockDb({
      customer: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => { throw new Error('connection lost') }),
      },
    })
    await expect(
      resolveVodapayCustomer({ db }, { externalId: 'u6', phone: '+27829999999' }),
    ).rejects.toThrow('connection lost')
  })

  it('returns the winning identity row when a concurrent login linked it first', async () => {
    const db = mockDb({
      customerExternalIdentity: {
        findUnique: vi.fn(async () => null),
        // The concurrent request won the race: the upsert finds an existing row
        // pointing at a different customer.
        upsert: vi.fn(async () => ({ customerId: 'cust_winner' })),
      },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u7', phone: '+27829999999' })
    expect(out).toEqual({ customerId: 'cust_winner', created: false })
  })
})

type AdminMock = {
  createUser: ReturnType<typeof vi.fn>
  updateUserById: ReturnType<typeof vi.fn>
}

function mockAdmin(overrides: Partial<AdminMock> = {}) {
  const createUser =
    overrides.createUser ?? vi.fn(async () => ({ data: { user: { id: 'auth_new' } }, error: null }))
  const updateUserById =
    overrides.updateUserById ?? vi.fn(async () => ({ data: { user: { id: 'auth_x' } }, error: null }))
  const admin = { auth: { admin: { createUser, updateUserById } } }
  return { admin: admin as unknown as Parameters<typeof resolveVodapayAuthUser>[0]['admin'], createUser, updateUserById }
}

function mockAuthDb(rows: unknown[]) {
  const queryRaw = vi.fn(async () => rows)
  return {
    db: { $queryRaw: queryRaw } as unknown as Parameters<typeof findVodapayAuthUserByPhone>[0]['db'],
    queryRaw,
  }
}

describe('findVodapayAuthUserByPhone', () => {
  it('returns null when no auth user carries the phone', async () => {
    const { db } = mockAuthDb([])
    expect(await findVodapayAuthUserByPhone({ db }, '+27821234567')).toBeNull()
  })

  it('extracts the metadata role so the caller can refuse staff accounts', async () => {
    const { db } = mockAuthDb([
      { id: 'auth_admin', email: 'ops@plugapro.co.za', raw_user_meta_data: { role: 'Admin' } },
    ])
    expect(await findVodapayAuthUserByPhone({ db }, '+27821234567')).toEqual({
      userId: 'auth_admin',
      email: 'ops@plugapro.co.za',
      metadataRole: 'admin',
    })
  })

  it('normalises a missing email and a metadata blob without a role', async () => {
    const { db } = mockAuthDb([{ id: 'auth_1', email: '   ', raw_user_meta_data: null }])
    expect(await findVodapayAuthUserByPhone({ db }, '+27821234567')).toEqual({
      userId: 'auth_1',
      email: null,
      metadataRole: null,
    })
  })
})

describe('resolveVodapayAuthUser', () => {
  it('never replaces an existing real email — it mints against that address', async () => {
    const { admin, createUser, updateUserById } = mockAdmin()
    const out = await resolveVodapayAuthUser(
      { admin },
      {
        externalId: 'u1',
        phone: '+27821234567',
        existing: { userId: 'auth_1', email: 'real@person.co.za', metadataRole: 'customer' },
      },
    )
    expect(out).toEqual({
      userId: 'auth_1',
      email: 'real@person.co.za',
      source: 'existing',
      metadataRole: 'customer',
    })
    expect(createUser).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('attaches the derived address only when the existing user has none', async () => {
    const { admin, updateUserById } = mockAdmin()
    const out = await resolveVodapayAuthUser(
      { admin },
      {
        externalId: 'u1',
        phone: '+27821234567',
        existing: { userId: 'auth_1', email: null, metadataRole: null },
      },
    )
    expect(out.email).toBe(vodapayAuthEmail('u1'))
    expect(updateUserById).toHaveBeenCalledWith('auth_1', {
      email: vodapayAuthEmail('u1'),
      email_confirm: true,
    })
  })

  it('creates a phone-confirmed user with the derived address when none exists', async () => {
    const { admin, createUser } = mockAdmin()
    const out = await resolveVodapayAuthUser(
      { admin },
      { externalId: 'u2', phone: '+27821234567', fullName: 'Thabo M', existing: null },
    )
    expect(out).toEqual({
      userId: 'auth_new',
      email: vodapayAuthEmail('u2'),
      source: 'created',
      metadataRole: 'customer',
    })
    expect(createUser).toHaveBeenCalledWith({
      phone: '27821234567',
      phone_confirm: true,
      email: vodapayAuthEmail('u2'),
      email_confirm: true,
      user_metadata: { role: 'customer', channel: 'vodapay', name: 'Thabo M' },
    })
  })

  it('falls back to the lookup path when the account appears mid-flight (phone_exists)', async () => {
    const { admin, createUser, updateUserById } = mockAdmin({
      createUser: vi.fn(async () => ({ data: null, error: { code: 'phone_exists' } })),
    })
    const { db, queryRaw } = mockAuthDb([
      { id: 'auth_raced', email: 'raced@person.co.za', raw_user_meta_data: { role: 'customer' } },
    ])
    const out = await resolveVodapayAuthUser(
      { admin, db },
      { externalId: 'u3', phone: '+27821234567', existing: null },
    )
    expect(out).toEqual({
      userId: 'auth_raced',
      email: 'raced@person.co.za',
      source: 'existing',
      metadataRole: 'customer',
    })
    expect(createUser).toHaveBeenCalledOnce()
    expect(queryRaw).toHaveBeenCalledOnce()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('throws rather than guessing when createUser fails for any other reason', async () => {
    const { admin } = mockAdmin({
      createUser: vi.fn(async () => ({ data: null, error: { code: 'email_exists' } })),
    })
    await expect(
      resolveVodapayAuthUser({ admin }, { externalId: 'u4', phone: '+27821234567', existing: null }),
    ).rejects.toThrow('Supabase user creation failed')
  })
})
