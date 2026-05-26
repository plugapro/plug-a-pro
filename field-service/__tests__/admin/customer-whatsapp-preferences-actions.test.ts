import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCrudAction,
  mockRequireAdmin,
  mockRevalidatePath,
  mockCustomerFindUnique,
  mockCustomerUpdate,
  mockPreferenceLogCreate,
} = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockCustomerFindUnique: vi.fn(),
  mockCustomerUpdate: vi.fn(),
  mockPreferenceLogCreate: vi.fn(),
}))

class MockCrudActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

vi.mock('@/lib/auth', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('@/lib/customer-lifecycle', () => ({
  mergeCustomers: vi.fn(),
  purgeArchivedCustomer: vi.fn(),
}))

vi.mock('@/lib/crud-action', () => ({
  CrudActionError: MockCrudActionError,
  crudAction: mockCrudAction,
}))

const tx = {
  customer: {
    findUnique: mockCustomerFindUnique,
    update: mockCustomerUpdate,
  },
  whatsappPreferenceLog: {
    create: mockPreferenceLogCreate,
  },
}

describe('toggleWhatsappMarketingAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ id: 'admin-user-1', adminRole: 'ADMIN' })
    mockCustomerFindUnique.mockResolvedValue({
      id: 'customer-1',
      whatsappMarketingOptIn: false,
    })
    mockCustomerUpdate.mockResolvedValue({ id: 'customer-1' })
    mockPreferenceLogCreate.mockResolvedValue({ id: 'pref-log-1' })
    mockCrudAction.mockImplementation(async (options) => {
      const data = await options.run(options.input, tx)
      return { ok: true, data }
    })
  })

  it('uses the specific WhatsApp preference flag and writes the preference log inside the audited mutation', async () => {
    const { toggleWhatsappMarketingAction } = await import('@/app/(admin)/admin/customers/actions')

    const result = await toggleWhatsappMarketingAction({
      customerId: 'customer-1',
      value: true,
    })

    expect(result).toEqual({
      ok: true,
      data: { id: 'customer-1', whatsappMarketingOptIn: true },
    })
    expect(mockCrudAction).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'Customer',
        entityId: 'customer-1',
        action: 'customer.whatsapp_marketing_toggle',
        requiredFlag: 'admin.customers.whatsapp_pref_toggle',
        requiredRole: ['OPS', 'TRUST', 'ADMIN', 'OWNER'],
      }),
    )
    expect(mockCustomerUpdate).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: expect.objectContaining({
        whatsappMarketingOptIn: true,
        whatsappMarketingSource: 'admin',
        whatsappMarketingOptInAt: expect.any(Date),
        lastWhatsappPrefSyncAt: expect.any(Date),
      }),
    })
    expect(mockPreferenceLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        field: 'whatsappMarketingOptIn',
        oldValue: false,
        newValue: true,
        source: 'admin',
        actorId: 'admin-user-1',
        note: 'Admin override from customer detail',
      }),
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/customers')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/customers/customer-1')
  })
})
