import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCrudAction,
  mockCustomerFindUnique,
  mockCustomerCreate,
  mockCustomerUpdate,
  mockProviderFindUnique,
  mockProviderCreate,
  mockProviderUpdate,
  mockProviderNoteCreate,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockCustomerFindUnique: vi.fn(),
  mockCustomerCreate: vi.fn(),
  mockCustomerUpdate: vi.fn(),
  mockProviderFindUnique: vi.fn(),
  mockProviderCreate: vi.fn(),
  mockProviderUpdate: vi.fn(),
  mockProviderNoteCreate: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

class MockCrudActionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CrudActionError'
    this.code = code
  }
}

vi.mock('@/lib/crud-action', () => ({
  CrudActionError: MockCrudActionError,
  crudAction: mockCrudAction,
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    id: 'session-admin-1',
    adminUserId: 'admin-user-1',
    adminRole: 'OWNER',
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()

  mockCrudAction.mockImplementation(async (opts: {
    input: unknown
    run: (input: unknown, tx: {
      customer: {
        findUnique: typeof mockCustomerFindUnique
        create: typeof mockCustomerCreate
        update: typeof mockCustomerUpdate
      }
      provider: {
        findUnique: typeof mockProviderFindUnique
        create: typeof mockProviderCreate
        update: typeof mockProviderUpdate
      }
      providerNote: {
        create: typeof mockProviderNoteCreate
      }
    }) => Promise<unknown>
  }) => {
    const tx = {
      customer: {
        findUnique: mockCustomerFindUnique,
        create: mockCustomerCreate,
        update: mockCustomerUpdate,
      },
      provider: {
        findUnique: mockProviderFindUnique,
        create: mockProviderCreate,
        update: mockProviderUpdate,
      },
      providerNote: {
        create: mockProviderNoteCreate,
      },
    }

    return { ok: true as const, data: await opts.run(opts.input, tx) }
  })
})

describe('customer/provider admin actions', () => {
  it('createCustomerAction refuses a duplicate phone', async () => {
    const { createCustomerAction } = await import('@/app/(admin)/admin/customers/actions')

    mockCustomerFindUnique.mockResolvedValue({ id: 'cust-existing' })

    await expect(
      createCustomerAction({
        name: 'Alice',
        phone: '+27821234567',
        email: 'alice@example.com',
        channel: 'WHATSAPP',
        address: 'Cape Town',
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Customer phone +27821234567 already exists.',
    })

    expect(mockCustomerCreate).not.toHaveBeenCalled()
  })

  it('createProviderAction refuses a duplicate phone', async () => {
    const { createProviderAction } = await import('@/app/(admin)/admin/providers/actions')

    mockProviderFindUnique.mockResolvedValue({ id: 'prov-existing' })

    await expect(
      createProviderAction({
        name: 'Plumber Pro',
        phone: '+27829876543',
        email: 'pro@example.com',
        experience: '5 years',
        skills: 'plumbing, leak detection',
        serviceAreas: 'Sandton, Randburg',
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })

    expect(mockProviderCreate).not.toHaveBeenCalled()
  })

  it('suspendCustomerFromFormAction normalizes datetime-local input to ISO before validation', async () => {
    const { suspendCustomerFromFormAction } = await import('@/app/(admin)/admin/customers/actions')
    const formData = new FormData()
    formData.append('customerId', 'cust-1')
    formData.append('until', '2026-05-01T10:30')
    formData.append('reason', 'Chargeback review')

    await suspendCustomerFromFormAction(formData)

    const lastCall = mockCrudAction.mock.calls.at(-1)?.[0]
    expect(typeof lastCall?.input?.until).toBe('string')
    expect(() => new Date(lastCall.input.until).toISOString()).not.toThrow()
  })

  it('addProviderStrikeAction writes a strike note and increments provider strikes', async () => {
    const { addProviderStrikeAction } = await import('@/app/(admin)/admin/providers/actions')

    mockProviderNoteCreate.mockResolvedValue({ id: 'note-1' })
    mockProviderUpdate.mockResolvedValue({ id: 'prov-1' })

    const result = await addProviderStrikeAction({
      providerId: 'prov-1',
      body: 'Customer reported a no-show.',
      reasonCode: 'PROVIDER_STRIKE_NO_SHOW',
    })

    expect(result).toEqual({ ok: true, data: { id: 'note-1' } })
    expect(mockProviderNoteCreate).toHaveBeenCalledWith({
      data: {
        providerId: 'prov-1',
        authorId: 'admin-user-1',
        body: 'Customer reported a no-show.',
        pinned: true,
        reasonCode: 'PROVIDER_STRIKE_NO_SHOW',
        strikeDelta: 1,
      },
      select: { id: true },
    })
    expect(mockProviderUpdate).toHaveBeenCalledWith({
      where: { id: 'prov-1' },
      data: {
        strikes: {
          increment: 1,
        },
      },
    })
  })
})
