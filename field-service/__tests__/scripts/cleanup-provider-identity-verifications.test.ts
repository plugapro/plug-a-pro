import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('cleanup-provider-identity-verifications', () => {
  const targetRows = [
    {
      id: 'ver-failed-1',
      providerId: 'provider-1',
      status: 'FAILED',
      documents: [
        { id: 'doc-1', blobKey: 'supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf' },
      ],
      securityEvents: [{ id: 'sec-non-audit', eventType: 'OTP_RATE_LIMIT_EXCEEDED' }],
    },
    {
      id: 'ver-started-1',
      providerId: 'provider-1',
      status: 'STARTED',
      documents: [],
      securityEvents: [{ id: 'sec-1', eventType: 'IDENTITY_VERIFICATION_PILOT_BREACH' }],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('plans deletion of non-kept rows and reports blocking security events', async () => {
    const { planCleanup } = await import('../../scripts/cleanup-provider-identity-verifications')
    const client = {
      providerIdentityVerification: {
        findMany: vi.fn().mockResolvedValue(targetRows),
      },
    }

    const plan = await planCleanup({
      providerId: 'provider-1',
      keepStatus: 'PASSED',
      client,
    })

    expect(client.providerIdentityVerification.findMany).toHaveBeenCalledWith({
      where: {
        providerId: 'provider-1',
        status: { not: 'PASSED' },
      },
      include: {
        documents: { select: { id: true, blobKey: true } },
        securityEvents: { select: { id: true, eventType: true, severity: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    expect(plan.verificationIds).toEqual(['ver-failed-1', 'ver-started-1'])
    expect(plan.blobKeys).toEqual(['supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf'])
    expect(plan.blockingSecurityEvents).toEqual([
      {
        verificationId: 'ver-started-1',
        securityEventId: 'sec-1',
        eventType: 'IDENTITY_VERIFICATION_PILOT_BREACH',
      },
    ])
  })

  it('dry-runs without deleting rows or purging storage', async () => {
    const { executeCleanupPlan } = await import('../../scripts/cleanup-provider-identity-verifications')
    const client = {
      $transaction: vi.fn(),
    }
    const deleteBlob = vi.fn()

    const result = await executeCleanupPlan({
      plan: {
        providerId: 'provider-1',
        keepStatus: 'PASSED',
        targetRows: [targetRows[0]],
        verificationIds: ['ver-failed-1'],
        blobKeys: ['supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf'],
        blockingSecurityEvents: [],
      },
      adminId: 'admin-1',
      confirm: false,
      client,
      deleteBlob,
      now: new Date('2026-05-27T09:00:00.000Z'),
    })

    expect(result).toEqual({ exitCode: 0, committed: false, purgeFailures: [] })
    expect(client.$transaction).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('commits DB cleanup then purges storage blobs', async () => {
    const { executeCleanupPlan } = await import('../../scripts/cleanup-provider-identity-verifications')
    const tx = {
      securityEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      providerIdentityVerification: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
    const client = {
      $transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx)
      }),
    }
    const deleteBlob = vi.fn().mockResolvedValue({ backend: 'supabase', ok: true })

    const result = await executeCleanupPlan({
      plan: {
        providerId: 'provider-1',
        keepStatus: 'PASSED',
        targetRows: [targetRows[0]],
        verificationIds: ['ver-failed-1'],
        blobKeys: ['supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf'],
        blockingSecurityEvents: [],
      },
      adminId: 'admin-1',
      confirm: true,
      client,
      deleteBlob,
      now: new Date('2026-05-27T09:00:00.000Z'),
    })

    expect(result).toEqual({ exitCode: 0, committed: true, purgeFailures: [] })
    expect(tx.providerIdentityVerification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ver-failed-1'] } },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        actorRole: 'admin',
        action: 'provider_identity_verification.cleanup_delete',
        entityType: 'ProviderIdentityVerification',
        entityId: 'ver-failed-1',
      }),
    })
    expect(deleteBlob).toHaveBeenCalledWith('supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf')
  })

  it('returns exit code 2 when storage purge fails after DB commit', async () => {
    const { executeCleanupPlan } = await import('../../scripts/cleanup-provider-identity-verifications')
    const tx = {
      securityEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      providerIdentityVerification: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
    const client = {
      $transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<void>) => {
        await callback(tx)
      }),
    }
    const deleteBlob = vi.fn().mockResolvedValue({
      backend: 'supabase',
      ok: false,
      error: '500 storage unavailable',
    })

    const result = await executeCleanupPlan({
      plan: {
        providerId: 'provider-1',
        keepStatus: 'PASSED',
        targetRows: [targetRows[0]],
        verificationIds: ['ver-failed-1'],
        blobKeys: ['supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf'],
        blockingSecurityEvents: [],
      },
      adminId: 'admin-1',
      confirm: true,
      client,
      deleteBlob,
      now: new Date('2026-05-27T09:00:00.000Z'),
    })

    expect(result.exitCode).toBe(2)
    expect(result.committed).toBe(true)
    expect(result.purgeFailures).toEqual([
      {
        blobKey: 'supabase://identity-documents/identity/ver-failed-1/ID_FRONT.pdf',
        backend: 'supabase',
        error: '500 storage unavailable',
      },
    ])
  })
})
