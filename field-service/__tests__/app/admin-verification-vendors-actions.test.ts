import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCrudAction, mockRevalidatePath } = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('@/lib/crud-action', () => ({
  crudAction: mockCrudAction,
}))

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    verificationVendorConfig: {
      upsert: vi.fn(),
    },
  },
}))

describe('verification vendor admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCrudAction.mockImplementation(async ({ schema, input, run }) => {
      const parsed = schema.parse(input)
      await run(parsed, {
        verificationVendorConfig: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          upsert: vi.fn().mockResolvedValue({ vendorKey: parsed.vendorKey }),
        },
      })
      return { ok: true }
    })
  })

  it('allows operators to save Didit vendor configuration from the admin UI', async () => {
    const { updateVendorConfigAction } = await import('@/app/(admin)/admin/verifications/vendors/actions')
    const input = {
      vendorKey: 'didit',
      confidenceThreshold: 0.95,
      livenessRequired: true,
    } as unknown as Parameters<typeof updateVendorConfigAction>[0]

    const result = await updateVendorConfigAction(input)

    expect(result).toEqual({ ok: true })
    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'didit',
      action: 'verification_vendor_config.update',
    }))
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/verifications/vendors')
  })

  it('allows owners to activate Didit from the admin UI', async () => {
    const { activateVendorConfigAction } = await import('@/app/(admin)/admin/verifications/vendors/actions')
    const input = { vendorKey: 'didit' } as unknown as Parameters<typeof activateVendorConfigAction>[0]

    const result = await activateVendorConfigAction(input)

    expect(result).toEqual({ ok: true })
    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'didit',
      action: 'verification_vendor_config.activate',
    }))
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/verifications/vendors')
  })
})
