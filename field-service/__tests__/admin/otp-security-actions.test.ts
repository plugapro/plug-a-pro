import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCrudAction,
  mockRequireAdmin,
  mockClearLock,
  mockRevalidatePath,
  mockSecurityEventUpdate,
} = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockClearLock: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockSecurityEventUpdate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))
vi.mock('../../lib/auth', () => ({ requireAdmin: mockRequireAdmin }))
vi.mock('../../lib/otp-security', () => ({ clearLock: mockClearLock }))
vi.mock('../../lib/crud-action', () => ({
  CrudActionError: class CrudActionError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message)
      this.name = 'CrudActionError'
    }
  },
  crudAction: mockCrudAction,
}))

async function executeCrudActionWith(tx: unknown) {
  const { CrudActionError } = await import('../../lib/crud-action')
  mockCrudAction.mockImplementation(async (options: any) => {
    if (options.schema) {
      const parsed = options.schema.safeParse(options.input)
      if (!parsed.success) {
        throw new CrudActionError(
          'VALIDATION',
          parsed.error.issues.map((issue: any) => issue.message).join('; '),
        )
      }
      return { ok: true, data: await options.run(parsed.data, tx) }
    }
    return { ok: true, data: await options.run(options.input, tx) }
  })
}

describe('admin OTP security actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({
      id: 'supabase-admin-1',
      adminUserId: 'admin-1',
      adminRole: 'TRUST',
    })
    mockSecurityEventUpdate.mockResolvedValue({
      id: 'event-1',
      status: 'ACKNOWLEDGED',
    })
    mockClearLock.mockResolvedValue(undefined)
  })

  it('acknowledges a security event through crudAction with admin.security.otp', async () => {
    await executeCrudActionWith({ securityEvent: { update: mockSecurityEventUpdate } })
    const { acknowledgeSecurityEventAction } = await import(
      '../../app/(admin)/admin/otp-security/actions'
    )

    await expect(
      acknowledgeSecurityEventAction({ eventId: 'event-1', reason: 'Reviewed by trust desk' }),
    ).resolves.toMatchObject({ ok: true })

    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security_event.acknowledge',
      entity: 'SecurityEvent',
      entityId: 'event-1',
      requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
      requiredFlag: 'admin.security.otp',
      reason: 'Reviewed by trust desk',
    }))
    expect(mockSecurityEventUpdate).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'ACKNOWLEDGED' },
      select: expect.any(Object),
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/otp-security')
  })

  it('resolves a security event through crudAction', async () => {
    await executeCrudActionWith({ securityEvent: { update: mockSecurityEventUpdate } })
    const { resolveSecurityEventAction } = await import(
      '../../app/(admin)/admin/otp-security/actions'
    )

    await resolveSecurityEventAction({ eventId: 'event-1', reason: 'Lock confirmed and handled' })

    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security_event.resolve',
      entity: 'SecurityEvent',
      requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
      requiredFlag: 'admin.security.otp',
    }))
    expect(mockSecurityEventUpdate).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
        resolvedByUserId: 'admin-1',
      },
      select: expect.any(Object),
    })
  })

  it('marks a false positive through crudAction', async () => {
    await executeCrudActionWith({ securityEvent: { update: mockSecurityEventUpdate } })
    const { markFalsePositiveAction } = await import(
      '../../app/(admin)/admin/otp-security/actions'
    )

    await markFalsePositiveAction({ eventId: 'event-1', reason: 'Customer confirmed self-request' })

    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security_event.mark_false_positive',
      entity: 'SecurityEvent',
      requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
      requiredFlag: 'admin.security.otp',
    }))
    expect(mockSecurityEventUpdate).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'FALSE_POSITIVE',
        resolvedAt: expect.any(Date),
        resolvedByUserId: 'admin-1',
      },
      select: expect.any(Object),
    })
  })

  it('clears account lock and step-up through crudAction for TRUST or higher', async () => {
    await executeCrudActionWith({})
    const { clearAccountLockAction } = await import(
      '../../app/(admin)/admin/otp-security/actions'
    )

    await clearAccountLockAction({
      phoneE164: '+27821234567',
      reason: 'Verified customer identity by callback',
    })

    expect(mockCrudAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security_account.clear_lock',
      entity: 'AccountSecurityState',
      entityId: '+27821234567',
      requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
      requiredFlag: 'admin.security.otp',
      reason: 'Verified customer identity by callback',
    }))
    expect(mockClearLock).toHaveBeenCalledWith('+27821234567', { byAdminId: 'admin-1' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/otp-security')
  })

  it('blocks non-admin and flag-disabled mutations through existing guards', async () => {
    mockRequireAdmin.mockRejectedValueOnce(new Error('unauthorized'))
    const { acknowledgeSecurityEventAction, resolveSecurityEventAction } = await import(
      '../../app/(admin)/admin/otp-security/actions'
    )

    await expect(
      acknowledgeSecurityEventAction({ eventId: 'event-1' }),
    ).rejects.toThrow('unauthorized')
    expect(mockCrudAction).not.toHaveBeenCalled()

    const { CrudActionError } = await import('../../lib/crud-action')
    mockRequireAdmin.mockResolvedValueOnce({
      id: 'supabase-admin-1',
      adminUserId: 'admin-1',
      adminRole: 'TRUST',
    })
    mockCrudAction.mockRejectedValueOnce(
      new CrudActionError('FLAG_DISABLED', "Feature 'admin.security.otp' is not enabled."),
    )

    await expect(
      resolveSecurityEventAction({ eventId: 'event-1' }),
    ).rejects.toMatchObject({ code: 'FLAG_DISABLED' })
    expect(mockSecurityEventUpdate).not.toHaveBeenCalled()
  })
})
