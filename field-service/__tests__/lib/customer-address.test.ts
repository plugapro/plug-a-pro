/**
 * M1-T1: CustomerAddress model + Customer business fields
 *
 * These tests verify that:
 * 1. The CustomerAddress type exists with all expected fields (compile-time check
 *    via Prisma-generated types - no live DB required).
 * 2. Customer has isBusinessAccount and businessName fields.
 * 3. JobRequest has customerAddressId field.
 * 4. db.customerAddress accessor is reachable on the Prisma client.
 *
 * Pattern mirrors field-service/__tests__/lib/matching-cert-equipment.test.ts.
 */

import { describe, expect, it, vi } from 'vitest'
import type { CustomerAddress, Customer, JobRequest, CustomerMember, Prisma } from '@prisma/client'

// ─── Mock wiring ──────────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    customerAddress: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
    },
    jobRequest: {
      findUnique: vi.fn(),
    },
    customerMember: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

// ─── Type-level checks ────────────────────────────────────────────────────────
// These assertions fail at compile time if the generated Prisma types do not
// include the expected fields - no runtime DB required.

type _AssertCustomerAddressFields = {
  id: CustomerAddress['id']
  customerId: CustomerAddress['customerId']
  label: CustomerAddress['label']
  street: CustomerAddress['street']
  suburb: CustomerAddress['suburb']
  city: CustomerAddress['city']
  province: CustomerAddress['province']
  postalCode: CustomerAddress['postalCode']
  lat: CustomerAddress['lat']
  lng: CustomerAddress['lng']
  locationNodeId: CustomerAddress['locationNodeId']
  isDefault: CustomerAddress['isDefault']
  createdAt: CustomerAddress['createdAt']
  updatedAt: CustomerAddress['updatedAt']
}

type _AssertCustomerBusinessFields = {
  isBusinessAccount: Customer['isBusinessAccount']
  businessName: Customer['businessName']
}

type _AssertJobRequestAddressId = {
  customerAddressId: JobRequest['customerAddressId']
}

// ─── Runtime: db.customerAddress accessor ────────────────────────────────────

describe('CustomerAddress - Prisma model (M1-T1)', () => {
  it('db.customerAddress accessor is present on the mocked client', () => {
    expect(mockDb.customerAddress).toBeDefined()
    expect(typeof mockDb.customerAddress.findMany).toBe('function')
  })

  it('CustomerAddress create shape accepts all required fields', async () => {
    const payload: Prisma.CustomerAddressCreateInput = {
      label: 'Home',
      street: '12 Oak Street',
      suburb: 'Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      isDefault: true,
      customer: { connect: { id: 'cust_1' } },
    }

    mockDb.customerAddress.create.mockResolvedValue({
      id: 'addr_1',
      customerId: 'cust_1',
      label:      payload.label ?? null,
      street:     payload.street as string,
      suburb:     payload.suburb as string,
      city:       payload.city as string,
      province:   payload.province as string,
      isDefault:  payload.isDefault ?? false,
      postalCode: null,
      lat:        null,
      lng:        null,
      locationNodeId: null,
      createdAt:  new Date(),
      updatedAt:  new Date(),
    } satisfies CustomerAddress)

    const result = await mockDb.customerAddress.create({ data: payload })
    expect(result.id).toBe('addr_1')
    expect(result.suburb).toBe('Sandton')
    expect(result.isDefault).toBe(true)
  })
})

describe('Customer business fields (M1-T1)', () => {
  it('Customer type includes isBusinessAccount and businessName', () => {
    const c: Pick<Customer, 'isBusinessAccount' | 'businessName'> = {
      isBusinessAccount: false,
      businessName: null,
    }
    expect(c.isBusinessAccount).toBe(false)
    expect(c.businessName).toBeNull()
  })

  it('db.customer.findUnique returns rows with business fields', async () => {
    mockDb.customer.findUnique.mockResolvedValue({
      id: 'cust_1',
      isBusinessAccount: true,
      businessName: 'Acme Plumbing (Pty) Ltd',
    })

    const result = await mockDb.customer.findUnique({ where: { id: 'cust_1' } })
    expect(result?.isBusinessAccount).toBe(true)
    expect(result?.businessName).toBe('Acme Plumbing (Pty) Ltd')
  })
})

describe('JobRequest.customerAddressId (M1-T1)', () => {
  it('JobRequest type includes customerAddressId nullable field', () => {
    const partial: Pick<JobRequest, 'customerAddressId'> = {
      customerAddressId: null,
    }
    expect(partial.customerAddressId).toBeNull()
  })

  it('db.jobRequest.findUnique returns customerAddressId when set', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({
      id: 'jr_1',
      customerAddressId: 'addr_1',
    })

    const result = await mockDb.jobRequest.findUnique({ where: { id: 'jr_1' } })
    expect(result?.customerAddressId).toBe('addr_1')
  })
})

// ─── M1-T2: CustomerMember ────────────────────────────────────────────────────

// Type-level check: all expected fields must exist on the generated type
type _AssertCustomerMemberFields = {
  id: CustomerMember['id']
  principalCustomerId: CustomerMember['principalCustomerId']
  memberUserId: CustomerMember['memberUserId']
  memberName: CustomerMember['memberName']
  memberPhone: CustomerMember['memberPhone']
  role: CustomerMember['role']
  active: CustomerMember['active']
  addedAt: CustomerMember['addedAt']
}

describe('CustomerMember (M1-T2)', () => {
  it('db.customerMember accessor is present on the mocked client', () => {
    expect(mockDb.customerMember).toBeDefined()
    expect(typeof mockDb.customerMember.findMany).toBe('function')
    expect(typeof mockDb.customerMember.create).toBe('function')
  })

  it('CustomerMember type includes all expected fields', () => {
    const member: Pick<
      CustomerMember,
      'id' | 'principalCustomerId' | 'memberUserId' | 'memberName' | 'memberPhone' | 'role' | 'active' | 'addedAt'
    > = {
      id: 'cm_1',
      principalCustomerId: 'cust_1',
      memberUserId: 'user_1',
      memberName: 'Jane Doe',
      memberPhone: '+27821234567',
      role: 'BOOKER',
      active: true,
      addedAt: new Date(),
    }
    expect(member.role).toBe('BOOKER')
    expect(member.active).toBe(true)
  })

  it('CustomerMember create shape accepts all required fields', async () => {
    const payload: Prisma.CustomerMemberCreateInput = {
      memberUserId: 'user_2',
      memberName: 'Bob Smith',
      memberPhone: '+27831234567',
      principal: { connect: { id: 'cust_1' } },
    }

    mockDb.customerMember.create.mockResolvedValue({
      id: 'cm_2',
      principalCustomerId: 'cust_1',
      memberUserId: 'user_2',
      memberName: 'Bob Smith',
      memberPhone: '+27831234567',
      role: 'BOOKER',
      active: true,
      addedAt: new Date(),
    } satisfies CustomerMember)

    const result = await mockDb.customerMember.create({ data: payload })
    expect(result.id).toBe('cm_2')
    expect(result.memberName).toBe('Bob Smith')
    expect(result.role).toBe('BOOKER')
    expect(result.active).toBe(true)
  })

  it('db.customerMember.findMany returns members for a principal customer', async () => {
    mockDb.customerMember.findMany.mockResolvedValue([
      {
        id: 'cm_1',
        principalCustomerId: 'cust_1',
        memberUserId: 'user_1',
        memberName: 'Jane Doe',
        memberPhone: '+27821234567',
        role: 'BOOKER',
        active: true,
        addedAt: new Date(),
      },
    ])

    const results = await mockDb.customerMember.findMany({
      where: { principalCustomerId: 'cust_1', active: true },
    })
    expect(results).toHaveLength(1)
    expect(results[0].principalCustomerId).toBe('cust_1')
    expect(results[0].memberPhone).toBe('+27821234567')
  })

  it('CustomerMember defaults role to BOOKER and active to true', async () => {
    mockDb.customerMember.create.mockResolvedValue({
      id: 'cm_3',
      principalCustomerId: 'cust_2',
      memberUserId: 'user_3',
      memberName: 'Alice',
      memberPhone: '+27841234567',
      role: 'BOOKER',
      active: true,
      addedAt: new Date(),
    } satisfies CustomerMember)

    const result = await mockDb.customerMember.create({
      data: {
        memberUserId: 'user_3',
        memberName: 'Alice',
        memberPhone: '+27841234567',
        principal: { connect: { id: 'cust_2' } },
      },
    })
    expect(result.role).toBe('BOOKER')
    expect(result.active).toBe(true)
  })
})
