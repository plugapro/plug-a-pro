import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDb,
} = vi.hoisted(() => ({
  mockDb: {
    customerAddress: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    address: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

describe('customer address book sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a reusable default address when none exists', async () => {
    const { syncReusableCustomerAddressFromSnapshot } = await import('@/lib/customer-address-book')
    const tx = {
      customerAddress: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'site-1',
          isDefault: true,
        }),
      },
    }

    const result = await syncReusableCustomerAddressFromSnapshot(tx as any, {
      customerId: 'cust-1',
      authUserId: 'user-1',
      customerPhone: '+27821234567',
      source: 'pwa',
      snapshot: {
        street: '12 Main Road',
        suburb: 'Constantia Kloof',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '1709',
        locationNodeId: 'node-1',
      },
    })

    expect(tx.customerAddress.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'cust-1',
        street: '12 Main Road',
        suburb: 'Constantia Kloof',
        city: 'Johannesburg',
        province: 'Gauteng',
        isDefault: true,
      }),
    }))
    expect(result).toEqual({
      customerAddressId: 'site-1',
      created: true,
      wasDefault: true,
    })
  })

  it('matches and updates existing reusable address instead of creating duplicate', async () => {
    const { syncReusableCustomerAddressFromSnapshot } = await import('@/lib/customer-address-book')
    const tx = {
      customerAddress: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'site-1',
            customerId: 'cust-1',
            label: null,
            street: '12 Main Road',
            suburb: 'Constantia Kloof',
            city: 'Johannesburg',
            province: 'Gauteng',
            postalCode: '1709',
            lat: null,
            lng: null,
            locationNodeId: 'node-1',
            isDefault: false,
            createdAt: new Date(),
          },
        ]),
        update: vi.fn().mockResolvedValue({
          id: 'site-1',
          isDefault: false,
        }),
        create: vi.fn(),
      },
    }

    const result = await syncReusableCustomerAddressFromSnapshot(tx as any, {
      customerId: 'cust-1',
      source: 'whatsapp',
      snapshot: {
        street: '12 Main Road',
        suburb: 'Constantia Kloof',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '1709',
        locationNodeId: 'node-1',
      },
    })

    expect(tx.customerAddress.update).toHaveBeenCalledOnce()
    expect(tx.customerAddress.create).not.toHaveBeenCalled()
    expect(result).toEqual({
      customerAddressId: 'site-1',
      created: false,
      wasDefault: false,
    })
  })

  it('promotes latest structured request address when reusable list is empty', async () => {
    const { resolveReusableCustomerSites } = await import('@/lib/customer-address-book')

    mockDb.customerAddress.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'site-1',
          label: '12 Main Road',
          street: '12 Main Road',
          suburb: 'Constantia Kloof',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '1709',
          locationNodeId: 'node-1',
          isDefault: true,
          createdAt: new Date(),
          locationNode: { regionKey: 'jhb_west' },
        },
      ])
    mockDb.address.findMany
      .mockResolvedValueOnce([
        {
          id: 'addr-1',
          street: '12 Main Road',
          addressLine1: '12 Main Road',
          addressLine2: 'Gate 2',
          complexName: 'Acacia Mews',
          unitNumber: '12B',
          suburb: 'Constantia Kloof',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '1709',
          locationNodeId: 'node-1',
          isDefault: true,
          createdAt: new Date(),
          locationNode: { regionKey: 'jhb_west' },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'addr-1',
          street: '12 Main Road',
          addressLine1: '12 Main Road',
          addressLine2: 'Gate 2',
          complexName: 'Acacia Mews',
          unitNumber: '12B',
          suburb: 'Constantia Kloof',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '1709',
          locationNodeId: 'node-1',
          isDefault: true,
          createdAt: new Date(),
          locationNode: { regionKey: 'jhb_west' },
        },
      ])

    mockDb.$transaction.mockImplementation(async (fn: any) => fn({
      customerAddress: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'site-1',
          isDefault: true,
        }),
      },
    }))

    const sites = await resolveReusableCustomerSites({
      customerId: 'cust-1',
      authUserId: 'user-1',
      customerPhone: '+27821234567',
      source: 'pwa',
    })

    expect(mockDb.$transaction).toHaveBeenCalledOnce()
    expect(sites).toEqual([
      expect.objectContaining({
        id: 'site-1',
        street: '12 Main Road',
        unitNumber: '12B',
        complexName: 'Acacia Mews',
        addressLine2: 'Gate 2',
      }),
    ])
  })
})
