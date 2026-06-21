import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAwardPromoCreditsForMilestone,
  mockCheckJobsForNewProviderAvailability,
  mockFindConflictingActiveProviderApplications,
  mockIsEnabled,
  mockNotifyProviderApplicationApprovedOnce,
  mockRecordAuditLog,
  mockReleaseOpsQueueItem,
  mockResolveServiceCategoryTag,
  mockSyncProviderRecord,
} = vi.hoisted(() => ({
  mockAwardPromoCreditsForMilestone: vi.fn(),
  mockCheckJobsForNewProviderAvailability: vi.fn(),
  mockFindConflictingActiveProviderApplications: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockNotifyProviderApplicationApprovedOnce: vi.fn(),
  mockRecordAuditLog: vi.fn(),
  mockReleaseOpsQueueItem: vi.fn(),
  mockResolveServiceCategoryTag: vi.fn(),
  mockSyncProviderRecord: vi.fn(),
}))

// Default: kill switch ON so the existing approval-path assertions exercise the logic.
// The disabled-flag behaviour is covered by its own test.
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
// KYC hardening policy: keep the existing test surface (no KYC gating) by
// resolving "is KYC required?" to false. Dedicated KYC-gate behaviour is
// covered by __tests__/lib/provider-auto-approve-kyc-gate.test.ts.
vi.mock('@/lib/kyc-policy', () => ({
  isKycRequiredForActivation: vi.fn().mockResolvedValue(false),
  KYC_REQUIRED_FLAG: 'provider.kyc.required_for_activation',
  KYC_EXISTING_PROVIDER_GRACE_DAYS: 30,
}))
vi.mock('@/lib/provider-record', () => ({ syncProviderRecord: mockSyncProviderRecord }))
vi.mock('@/lib/provider-promo-awards', () => ({ awardPromoCreditsForMilestone: mockAwardPromoCreditsForMilestone }))
vi.mock('@/lib/ops-queue', () => ({ OPS_QUEUE_TYPES: { PROVIDER_ONBOARDING: 'PROVIDER_ONBOARDING' }, releaseOpsQueueItem: mockReleaseOpsQueueItem }))
vi.mock('@/lib/provider-application-notifications', () => ({ notifyProviderApplicationApprovedOnce: mockNotifyProviderApplicationApprovedOnce }))
vi.mock('@/lib/matching/customer-recontact', () => ({ checkJobsForNewProviderAvailability: mockCheckJobsForNewProviderAvailability }))
vi.mock('@/lib/provider-applications', () => ({ findConflictingActiveProviderApplications: mockFindConflictingActiveProviderApplications }))
vi.mock('@/lib/service-categories', () => ({
  SERVICE_CATEGORY_OPTIONS: [
    { tag: 'plumbing', label: 'Plumbing' },
    { tag: 'garden', label: 'Garden & Landscaping' },
    { tag: 'handyman', label: 'Handyman' },
    { tag: 'appliances', label: 'Appliances' },
    { tag: 'diy-assembly', label: 'DIY & Assembly' },
    { tag: 'cleaning', label: 'Cleaning' },
    { tag: 'tiling', label: 'Tiling' },
    { tag: 'carpentry', label: 'Carpentry' },
    { tag: 'electrical', label: 'Electrical' },
  ],
  resolveServiceCategoryTag: mockResolveServiceCategoryTag,
}))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mockRecordAuditLog }))

import { autoApproveProviderApplications, reconcileAutoApproveSideEffects } from '@/lib/provider-auto-approve'

const standardApplication = {
  id: 'app-standard',
  phone: '+27820000001',
  name: 'Lovemore Sibanda',
  skills: [
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
    mockIsEnabled.mockReset().mockResolvedValue(true)
  })

  it('returns early and approves nothing when provider.onboarding.auto_approve is disabled', async () => {
    mockIsEnabled.mockResolvedValue(false)

    const findMany = vi.fn().mockResolvedValue([standardApplication])
    const transaction = vi.fn()
    const client: any = {
      providerApplication: { findMany },
      $transaction: transaction,
    }

    const result = await autoApproveProviderApplications(client)

    expect(mockIsEnabled).toHaveBeenCalledWith('provider.onboarding.auto_approve')
    expect(result).toMatchObject({ attempted: 0, approved: 0 })
    expect(result.skippedReasons).toContain('AUTO_APPROVE_FLAG_DISABLED')
    // No DB reads or writes occur when the kill switch is off.
    expect(findMany).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
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
        createMany: vi.fn().mockResolvedValue({ count: 8 }),
        updateMany: vi.fn().mockResolvedValue({ count: 8 }),
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
      // Promo schema passes; marker schema absent → forces direct (non-marker) execution path.
      providerPromoAward: { count: vi.fn().mockResolvedValue(0) },
      paymentIntent: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    mockAwardPromoCreditsForMilestone.mockRejectedValueOnce(new Error('award table drift'))

    const result = await autoApproveProviderApplications(client)

    // VOUCHER_PILOT: PROMO_AWARD is now a no-op that returns 'done' immediately.
    // promoFailed stays 0; awardPromoCreditsForMilestone is never invoked.
    expect(result).toMatchObject({
      attempted: 1,
      approved: 1,
      skipped: 0,
      errors: 0,
      sideEffectSummary: {
        promoFailed: 0,
      },
    })
    expect(mockReleaseOpsQueueItem).toHaveBeenCalled()
    expect(mockAwardPromoCreditsForMilestone).not.toHaveBeenCalled()
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
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockRejectedValue(new Error('relation \"provider_auto_approve_side_effect_markers\" does not exist')),
      update: vi.fn().mockResolvedValue(undefined),
    }

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([standardApplication]),
        findUnique: vi.fn().mockResolvedValue({
          id: 'app-standard',
          status: 'APPROVED',
          phone: standardApplication.phone,
          name: standardApplication.name,
        }),
      },
      providerPromoAward: { count: vi.fn().mockResolvedValue(0) },
      paymentIntent: { count: vi.fn().mockResolvedValue(0) },
      providerAutoApproveSideEffectMarker: markerStorage,
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

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
    // VOUCHER_PILOT: PROMO_AWARD is now a no-op; awardPromoCreditsForMilestone is never invoked.
    expect(mockAwardPromoCreditsForMilestone).not.toHaveBeenCalled()
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
