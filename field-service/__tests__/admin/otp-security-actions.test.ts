import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCrudAction,
  mockRequireAdmin,
  mockClearLock,
  mockRevalidatePath,
  mockSecurityEventUpdate,
  mockSecurityEventUpdateMany,
  mockSecurityEventFindUnique,
} = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockClearLock: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockSecurityEventUpdate: vi.fn(),
  mockSecurityEventUpdateMany: vi.fn(),
  mockSecurityEventFindUnique: vi.fn(),
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

function securityEventTx() {
  return {
    securityEvent: {
      update: mockSecurityEventUpdate,
      updateMany: mockSecurityEventUpdateMany,
      findUnique: mockSecurityEventFindUnique,
    },
  }
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
    mockSecurityEventUpdateMany.mockResolvedValue({ count: 1 })
    mockSecurityEventFindUnique.mockResolvedValue({
      id: 'event-1',
      status: 'ACKNOWLEDGED',
      resolvedAt: null,
      resolvedByUserId: null,
    })
    mockClearLock.mockResolvedValue(undefined)
  })

  it('acknowledges a security event through crudAction with admin.security.otp', async () => {
    await executeCrudActionWith(securityEventTx())
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
    expect(mockSecurityEventUpdateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', status: 'NEW' },
      data: {
        status: 'ACKNOWLEDGED',
        resolvedAt: null,
        resolvedByUserId: null,
      },
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/admin/otp-security')
  })

  it('resolves a security event through crudAction', async () => {
    mockSecurityEventFindUnique.mockResolvedValue({
      id: 'event-1',
      status: 'RESOLVED',
      resolvedAt: new Date('2026-05-26T10:00:00.000Z'),
      resolvedByUserId: 'admin-1',
    })
    await executeCrudActionWith(securityEventTx())
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
    expect(mockSecurityEventUpdateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', status: { in: ['NEW', 'ACKNOWLEDGED'] } },
      data: {
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
        resolvedByUserId: 'admin-1',
      },
    })
  })

  it('marks a false positive through crudAction', async () => {
    mockSecurityEventFindUnique.mockResolvedValue({
      id: 'event-1',
      status: 'FALSE_POSITIVE',
      resolvedAt: new Date('2026-05-26T10:00:00.000Z'),
      resolvedByUserId: 'admin-1',
    })
    await executeCrudActionWith(securityEventTx())
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
    expect(mockSecurityEventUpdateMany).toHaveBeenCalledWith({
      where: { id: 'event-1', status: { in: ['NEW', 'ACKNOWLEDGED'] } },
      data: {
        status: 'FALSE_POSITIVE',
        resolvedAt: expect.any(Date),
        resolvedByUserId: 'admin-1',
      },
    })
  })

  it('rejects forged terminal status transitions without mutating the row', async () => {
    const { CrudActionError } = await import('../../lib/crud-action')
    mockSecurityEventUpdateMany.mockResolvedValue({ count: 0 })
    await executeCrudActionWith(securityEventTx())
    const {
      acknowledgeSecurityEventAction,
      resolveSecurityEventAction,
      markFalsePositiveAction,
    } = await import('../../app/(admin)/admin/otp-security/actions')

    await expect(
      acknowledgeSecurityEventAction({ eventId: 'resolved-event', reason: 'forged' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)
    await expect(
      resolveSecurityEventAction({ eventId: 'terminal-event', reason: 'forged' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)
    await expect(
      markFalsePositiveAction({ eventId: 'terminal-event', reason: 'forged' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<InstanceType<typeof CrudActionError>>)

    expect(mockSecurityEventUpdate).not.toHaveBeenCalled()
    expect(mockSecurityEventFindUnique).not.toHaveBeenCalled()
  })

  it('clears account lock and step-up through crudAction for TRUST or higher', async () => {
    const tx = { accountSecurityState: {}, securityEvent: {} }
    await executeCrudActionWith(tx)
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
    expect(mockClearLock).toHaveBeenCalledWith('+27821234567', {
      byAdminId: 'admin-1',
      client: tx,
    })
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
