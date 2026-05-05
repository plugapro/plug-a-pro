import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCrudAction,
  mockCategoryFindUnique,
  mockCategoryCreate,
  mockCategoryUpdate,
  mockCategoryDelete,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockCategoryFindUnique: vi.fn(),
  mockCategoryCreate: vi.fn(),
  mockCategoryUpdate: vi.fn(),
  mockCategoryDelete: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()

  mockCrudAction.mockImplementation(async (opts: {
    input: unknown
    run: (input: any, tx: {
      category: {
        findUnique: typeof mockCategoryFindUnique
        create: typeof mockCategoryCreate
        update: typeof mockCategoryUpdate
        delete: typeof mockCategoryDelete
      }
    }) => Promise<unknown>
  }) => {
    const tx = {
      category: {
        findUnique: mockCategoryFindUnique,
        create: mockCategoryCreate,
        update: mockCategoryUpdate,
        delete: mockCategoryDelete,
      },
    }

    return { ok: true as const, data: await opts.run(opts.input, tx) }
  })
})

describe('category admin actions', () => {
  it('createCategoryAction normalizes the slug and writes requirement rows', async () => {
    const { createCategoryAction } = await import('@/app/(admin)/admin/categories/actions')

    mockCategoryFindUnique.mockResolvedValue(null)
    mockCategoryCreate.mockResolvedValue({ id: 'cat-1' })

    const result = await createCategoryAction({
      slug: 'Drain Cleaning',
      label: 'Drain Cleaning',
      description: 'Blocked drains and jetting.',
      active: true,
      regulated: false,
      bookingOnAssignment: true,
      sortOrder: 2,
      requiredCertifications: 'drain_cert\njetting_cert',
      requiredEquipment: 'drain_snake, jetter',
      requiredVehicleTypes: 'van',
    })

    expect(result).toEqual({ ok: true, data: { id: 'cat-1' } })
    expect(mockCategoryFindUnique).toHaveBeenCalledWith({
      where: { slug: 'drain-cleaning' },
      select: { id: true },
    })
    expect(mockCategoryCreate).toHaveBeenCalledWith({
      data: {
        slug: 'drain-cleaning',
        label: 'Drain Cleaning',
        description: 'Blocked drains and jetting.',
        active: true,
        regulated: false,
        bookingOnAssignment: true,
        sortOrder: 2,
        requiredCertifications: {
          createMany: {
            data: [{ code: 'drain_cert' }, { code: 'jetting_cert' }],
          },
        },
        requiredEquipment: {
          createMany: {
            data: [{ tag: 'drain_snake' }, { tag: 'jetter' }],
          },
        },
        requiredVehicleTypes: {
          createMany: {
            data: [{ vehicleType: 'van' }],
          },
        },
      },
      select: { id: true },
    })
  })

  it('updateCategoryAction refuses duplicate slugs on another row', async () => {
    const { updateCategoryAction } = await import('@/app/(admin)/admin/categories/actions')

    mockCategoryFindUnique
      .mockResolvedValueOnce({ id: 'cat-1' })
      .mockResolvedValueOnce({ id: 'cat-2' })

    await expect(
      updateCategoryAction({
        categoryId: 'cat-1',
        slug: 'electrical',
        label: 'Electrical',
        description: '',
        active: true,
        regulated: true,
        bookingOnAssignment: false,
        sortOrder: 1,
        requiredCertifications: '',
        requiredEquipment: '',
        requiredVehicleTypes: '',
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Category slug electrical already exists.',
    })

    expect(mockCategoryUpdate).not.toHaveBeenCalled()
  })

  it('deleteCategoryAction deletes an existing category', async () => {
    const { deleteCategoryAction } = await import('@/app/(admin)/admin/categories/actions')

    mockCategoryFindUnique.mockResolvedValue({ id: 'cat-1' })
    mockCategoryDelete.mockResolvedValue({ id: 'cat-1' })

    const result = await deleteCategoryAction({ categoryId: 'cat-1' })

    expect(result).toEqual({ ok: true, data: { id: 'cat-1' } })
    expect(mockCategoryDelete).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
    })
  })
})
