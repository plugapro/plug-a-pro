import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAwardPromoCreditsForMilestone,
  mockCheckJobsForNewProviderAvailability,
  mockFindConflictingActiveProviderApplications,
  mockNotifyProviderApplicationApprovedOnce,
  mockRecordAuditLog,
  mockReleaseOpsQueueItem,
  mockResolveServiceCategoryTag,
  mockSyncProviderRecord,
} = vi.hoisted(() => ({
  mockAwardPromoCreditsForMilestone: vi.fn(),
  mockCheckJobsForNewProviderAvailability: vi.fn(),
  mockFindConflictingActiveProviderApplications: vi.fn(),
  mockNotifyProviderApplicationApprovedOnce: vi.fn(),
  mockRecordAuditLog: vi.fn(),
  mockReleaseOpsQueueItem: vi.fn(),
  mockResolveServiceCategoryTag: vi.fn(),
  mockSyncProviderRecord: vi.fn(),
}))

vi.mock('@/lib/provider-record', () => ({ syncProviderRecord: mockSyncProviderRecord }))
vi.mock('@/lib/provider-promo-awards', () => ({ awardPromoCreditsForMilestone: mockAwardPromoCreditsForMilestone }))
vi.mock('@/lib/ops-queue', () => ({ OPS_QUEUE_TYPES: { PROVIDER_ONBOARDING: 'PROVIDER_ONBOARDING' }, releaseOpsQueueItem: mockReleaseOpsQueueItem }))
vi.mock('@/lib/provider-application-notifications', () => ({ notifyProviderApplicationApprovedOnce: mockNotifyProviderApplicationApprovedOnce }))
vi.mock('@/lib/matching/customer-recontact', () => ({ checkJobsForNewProviderAvailability: mockCheckJobsForNewProviderAvailability }))
vi.mock('@/lib/provider-applications', () => ({ findConflictingActiveProviderApplications: mockFindConflictingActiveProviderApplications }))
vi.mock('@/lib/service-categories', () => ({ resolveServiceCategoryTag: mockResolveServiceCategoryTag }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mockRecordAuditLog }))

import { autoApproveProviderApplications, reconcileAutoApproveSideEffects } from '@/lib/provider-auto-approve'

const standardApplication = {
  id: 'app-standard',
  phone: '+27820000001',
  name: 'Lovemore Sibanda',
  skills: [
    'Plumbing',
    'Painting',
    'Garden & Landscaping',
    'Handyman',
    'Appliances',
    'DIY & Assembly',
    'Cleaning',
    'Tiling',
    'Carpentry',
  ],
  serviceAreas: ['Roodepoort'],
  experience: '10 years',
  notes: null,
  providerId: null,
  isTestUser: false,
  cohortName: 'default',
}

describe('provider auto-approval', () => {
  beforeEach(() => {
    mockSyncProviderRecord.mockReset().mockResolvedValue('provider-1')
    mockAwardPromoCreditsForMilestone.mockReset()
    mockReleaseOpsQueueItem.mockReset().mockResolvedValue({ count: 1 })
    mockNotifyProviderApplicationApprovedOnce.mockReset().mockResolvedValue({ status: 'sent', externalId: 'msg-1' })
    mockCheckJobsForNewProviderAvailability.mockReset().mockResolvedValue({ dispatchedOpenJobs: 0 })
    mockFindConflictingActiveProviderApplications.mockReset().mockResolvedValue([])
    mockResolveServiceCategoryTag.mockReset().mockReturnValue(undefined)
    mockRecordAuditLog.mockReset().mockResolvedValue(undefined)
  })

  it('does not auto-approve high-risk applications before manual certification review', async () => {
    const tx = {
      providerApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    }

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...standardApplication,
            id: 'app-hirisk',
            skills: ['Electrical', 'Handyman'],
          },
        ]),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 0,
      skipped: 1,
      errors: 0,
    })
    expect(mockFindConflictingActiveProviderApplications).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
    expect(mockReleaseOpsQueueItem).not.toHaveBeenCalled()
    expect(mockNotifyProviderApplicationApprovedOnce).not.toHaveBeenCalled()
    expect(mockCheckJobsForNewProviderAvailability).not.toHaveBeenCalled()
    expect(mockRecordAuditLog).not.toHaveBeenCalled()
  })

  it('rejects missing required fields without mutating queue or provider state', async () => {
    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...standardApplication,
            id: 'app-missing',
            serviceAreas: [],
            experience: null,
            skills: ['Electrical'],
          },
        ]),
      },
      $transaction: vi.fn(),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 0,
      skipped: 1,
      errors: 0,
    })
    expect(mockFindConflictingActiveProviderApplications).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
    expect(mockReleaseOpsQueueItem).not.toHaveBeenCalled()
  })

  it('skips approvals for conflicting active applications on the same phone', async () => {
    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          standardApplication,
        ]),
      },
      $transaction: vi.fn(),
    }

    mockFindConflictingActiveProviderApplications.mockResolvedValue([{ id: 'other-app' }])

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 0,
      skipped: 1,
      errors: 0,
    })
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
    expect(mockReleaseOpsQueueItem).not.toHaveBeenCalled()
  })

  it('auto-approves complete standard applications and queues non-critical side effects', async () => {
    const tx = {
      providerApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 9 }),
        updateMany: vi.fn().mockResolvedValue({ count: 9 }),
      },
    }

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([standardApplication]),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 1,
      skipped: 0,
      errors: 0,
      sideEffectSummary: {
        queueReleased: 1,
        notifyQueued: 1,
        enrichmentQueued: 1,
        promoAwarded: 0,
        promoFailed: 0,
      },
    })
    expect(mockSyncProviderRecord).toHaveBeenNthCalledWith(
      1,
      tx,
      expect.objectContaining({
        phone: '+27820000001',
        name: 'Lovemore Sibanda',
        skipEnrichment: true,
      }),
    )
    expect(mockSyncProviderRecord).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        phone: '+27820000001',
        name: 'Lovemore Sibanda',
        verified: true,
      }),
    )
    expect(mockReleaseOpsQueueItem).toHaveBeenCalledWith(tx, {
      queueType: 'PROVIDER_ONBOARDING',
      entityId: 'app-standard',
    })
  })

  it('keeps approvals durable when promo award throws in legacy schema', async () => {
    const tx = {
      providerApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([standardApplication]),
      },
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{ column_name: 'providerId' }, { column_name: 'awardType' }, { column_name: 'referenceType' }, { column_name: 'referenceId' }, { column_name: 'status' }, { column_name: 'metadata' }])
        .mockResolvedValueOnce([
          { enumlabel: 'MOBILE_VERIFIED' },
          { enumlabel: 'PROFILE_COMPLETED' },
          { enumlabel: 'KYC_APPROVED' },
          { enumlabel: 'FIRST_TOPUP' },
          { enumlabel: 'FIRST_COMPLETED_JOB' },
        ]),
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    mockAwardPromoCreditsForMilestone.mockRejectedValueOnce(new Error('award table drift'))

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 1,
      skipped: 0,
      errors: 0,
      sideEffectSummary: {
        promoFailed: 1,
      },
    })
    expect(mockReleaseOpsQueueItem).toHaveBeenCalled()
    expect(mockAwardPromoCreditsForMilestone).toHaveBeenCalledOnce()
  })

  it('falls back to direct side-effect execution when marker writes fail', async () => {
    const tx = {
      providerApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      providerCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    const markerStorage = {
      upsert: vi.fn().mockRejectedValue(new Error('relation \"provider_auto_approve_side_effect_markers\" does not exist')),
      update: vi.fn().mockResolvedValue(undefined),
    }

    const markerAndPromoPreflight = [
      // promo schema columns
      [{ column_name: 'providerId' }, { column_name: 'awardType' }, { column_name: 'referenceType' }, { column_name: 'referenceId' }, { column_name: 'status' }, { column_name: 'metadata' }],
      // promo schema enum
      [
        { enumlabel: 'MOBILE_VERIFIED' },
        { enumlabel: 'PROFILE_COMPLETED' },
        { enumlabel: 'KYC_APPROVED' },
        { enumlabel: 'FIRST_TOPUP' },
        { enumlabel: 'FIRST_COMPLETED_JOB' },
      ],
      // marker schema columns
      [{ column_name: 'id' }, { column_name: 'kind' }, { column_name: 'applicationId' }, { column_name: 'providerId' }, { column_name: 'sourceRefType' }, { column_name: 'sourceRefId' }, { column_name: 'status' }, { column_name: 'reason' }, { column_name: 'retryCount' }, { column_name: 'lastError' }, { column_name: 'runId' }, { column_name: 'attemptedAt' }, { column_name: 'nextRetryAt' }, { column_name: 'createdAt' }, { column_name: 'updatedAt' }],
      // marker kind enum
      [{ enumlabel: 'PROMO_AWARD' }, { enumlabel: 'NOTIFICATION' }, { enumlabel: 'MATCH_RECHECK' }],
      // marker status enum
      [{ enumlabel: 'PENDING' }, { enumlabel: 'DONE' }, { enumlabel: 'FAILED' }],
    ]

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([standardApplication]),
      },
      providerAutoApproveSideEffectMarker: markerStorage,
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    const query = client.$queryRaw as ReturnType<typeof vi.fn>
    markerAndPromoPreflight.forEach((row) => query.mockResolvedValueOnce(row))

    mockAwardPromoCreditsForMilestone.mockResolvedValue({
      awarded: false,
      skippedReason: 'DUPLICATE',
      award: null,
      wallet: null,
      ledgerEntries: [],
    })

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 1,
      skipped: 0,
      sideEffectSummary: {
        promoAwarded: 0,
        notifyQueued: 1,
        queueReleased: 1,
      },
    })
    expect(markerStorage.upsert).toHaveBeenCalled()
    expect(mockNotifyProviderApplicationApprovedOnce).toHaveBeenCalled()
    expect(mockCheckJobsForNewProviderAvailability).toHaveBeenCalled()
    expect(mockAwardPromoCreditsForMilestone).toHaveBeenCalled()
  })

  it('marks no-op when a concurrent worker already updated the row', async () => {
    const tx = {
      providerApplication: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      providerCategory: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([standardApplication]),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toMatchObject({
      attempted: 1,
      approved: 0,
      skipped: 1,
      errors: 0,
    })
    expect(mockSyncProviderRecord).toHaveBeenCalledTimes(1)
    expect(mockReleaseOpsQueueItem).not.toHaveBeenCalled()
    expect(mockNotifyProviderApplicationApprovedOnce).not.toHaveBeenCalled()
  })

  it('replays pending marker side effects during reconciliation', async () => {
    const sideEffectMarker = {
      id: 'marker-1',
      kind: 'PROMO_AWARD',
      applicationId: 'app-replay',
      providerId: 'provider-1',
      status: 'PENDING',
      reason: null,
      retryCount: 0,
      lastError: null,
      runId: null,
      nextRetryAt: null,
      attemptedAt: null,
      sourceRefType: 'provider_application',
      sourceRefId: 'app-replay',
    }

    const markerStorage = {
      findMany: vi.fn().mockResolvedValue([sideEffectMarker]),
      update: vi.fn().mockResolvedValue({ ...sideEffectMarker, status: 'DONE' }),
    }

    const client: any = {
      providerAutoApproveSideEffectMarker: markerStorage,
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'app-replay', status: 'APPROVED', phone: '+27820000009', name: 'Replay' }),
      },
    }

    mockAwardPromoCreditsForMilestone.mockResolvedValue({
      awarded: false,
      skippedReason: 'DUPLICATE',
      award: null,
      wallet: null,
      ledgerEntries: [],
    })

    const result = await reconcileAutoApproveSideEffects(client, { limit: 10 })

    expect(result).toEqual({ scanned: 1, replayed: 1, skipped: 0, hardFailed: 0 })
    expect(markerStorage.update).toHaveBeenCalled()
  })
})
