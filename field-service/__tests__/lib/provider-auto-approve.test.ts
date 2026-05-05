import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAwardMobileVerifiedPromoCreditsInTransaction,
  mockCheckJobsForNewProviderAvailability,
  mockFindConflictingActiveProviderApplications,
  mockNotifyProviderApplicationApprovedOnce,
  mockRecordAuditLog,
  mockReleaseOpsQueueItem,
  mockResolveServiceCategoryTag,
  mockSyncProviderRecord,
} = vi.hoisted(() => ({
  mockAwardMobileVerifiedPromoCreditsInTransaction: vi.fn(),
  mockCheckJobsForNewProviderAvailability: vi.fn(),
  mockFindConflictingActiveProviderApplications: vi.fn(),
  mockNotifyProviderApplicationApprovedOnce: vi.fn(),
  mockRecordAuditLog: vi.fn(),
  mockReleaseOpsQueueItem: vi.fn(),
  mockResolveServiceCategoryTag: vi.fn(),
  mockSyncProviderRecord: vi.fn(),
}))

vi.mock('@/lib/provider-record', () => ({ syncProviderRecord: mockSyncProviderRecord }))
vi.mock('@/lib/provider-promo-awards', () => ({ awardMobileVerifiedPromoCreditsInTransaction: mockAwardMobileVerifiedPromoCreditsInTransaction }))
vi.mock('@/lib/ops-queue', () => ({ OPS_QUEUE_TYPES: { PROVIDER_ONBOARDING: 'PROVIDER_ONBOARDING' }, releaseOpsQueueItem: mockReleaseOpsQueueItem }))
vi.mock('@/lib/provider-application-notifications', () => ({ notifyProviderApplicationApprovedOnce: mockNotifyProviderApplicationApprovedOnce }))
vi.mock('@/lib/matching/customer-recontact', () => ({ checkJobsForNewProviderAvailability: mockCheckJobsForNewProviderAvailability }))
vi.mock('@/lib/provider-applications', () => ({ findConflictingActiveProviderApplications: mockFindConflictingActiveProviderApplications }))
vi.mock('@/lib/service-categories', () => ({ resolveServiceCategoryTag: mockResolveServiceCategoryTag }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mockRecordAuditLog }))

import { autoApproveProviderApplications } from '@/lib/provider-auto-approve'

describe('provider auto-approval', () => {
  beforeEach(() => {
    mockSyncProviderRecord.mockReset().mockResolvedValue('provider-1')
    mockAwardMobileVerifiedPromoCreditsInTransaction.mockReset().mockResolvedValue(undefined)
    mockReleaseOpsQueueItem.mockReset().mockResolvedValue({ count: 1 })
    mockNotifyProviderApplicationApprovedOnce.mockReset().mockResolvedValue(undefined)
    mockCheckJobsForNewProviderAvailability.mockReset().mockResolvedValue(undefined)
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
        findMany: vi.fn()
          .mockResolvedValueOnce([
            {
              id: 'app-hirisk',
              phone: '+27821234567',
              name: 'Lovemore',
              skills: ['Electrical', 'Handyman'],
              serviceAreas: ['Bromhof'],
              experience: '8 years',
              notes: null,
              providerId: null,
              isTestUser: false,
              cohortName: 'default',
            },
          ])
          .mockResolvedValueOnce([]),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toEqual({ approved: 0, skipped: 1, errors: 0 })
    expect(mockFindConflictingActiveProviderApplications).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
    expect(mockReleaseOpsQueueItem).not.toHaveBeenCalled()
    expect(mockNotifyProviderApplicationApprovedOnce).not.toHaveBeenCalled()
    expect(mockCheckJobsForNewProviderAvailability).not.toHaveBeenCalled()
    expect(mockRecordAuditLog).not.toHaveBeenCalled()
  })

  it('still approves when promo-credit awarding fails', async () => {
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
        findMany: vi.fn()
          .mockResolvedValueOnce([
            {
              id: 'app-award-fail',
              phone: '+27820000001',
              name: 'Noah',
              skills: ['Painting'],
              serviceAreas: ['Roodepoort'],
              experience: '4 years',
              notes: null,
              providerId: null,
              isTestUser: false,
              cohortName: 'default',
            },
          ])
          .mockResolvedValueOnce([]),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    mockAwardMobileVerifiedPromoCreditsInTransaction.mockRejectedValueOnce(new Error('award column missing'))

    const result = await autoApproveProviderApplications(client)

    expect(result).toEqual({ approved: 1, skipped: 0, errors: 0 })
    expect(mockSyncProviderRecord).toHaveBeenCalledWith(tx, expect.objectContaining({
      phone: '+27820000001',
      name: 'Noah',
    }))
    expect(mockReleaseOpsQueueItem).toHaveBeenCalledWith(tx, {
      queueType: 'PROVIDER_ONBOARDING',
      entityId: 'app-award-fail',
    })
  })

  it('auto-approves complete standard multi-service applications including Plumbing', async () => {
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
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'app-lovemore-standard',
            phone: '+27820000002',
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
          },
        ]),
      },
      $transaction: vi.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) => callback(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toEqual({ approved: 1, skipped: 0, errors: 0 })
    expect(mockSyncProviderRecord).toHaveBeenCalledWith(tx, expect.objectContaining({
      phone: '+27820000002',
      name: 'Lovemore Sibanda',
      skills: expect.arrayContaining(['Plumbing', 'Carpentry']),
      active: true,
      availableNow: true,
      verified: true,
    }))
    expect(mockReleaseOpsQueueItem).toHaveBeenCalledWith(tx, {
      queueType: 'PROVIDER_ONBOARDING',
      entityId: 'app-lovemore-standard',
    })
  })

  it('skips auto-approval when required profile fields are missing', async () => {
    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'app-missing',
            phone: '+27821234568',
            name: 'Thabo',
            skills: ['Electrical'],
            serviceAreas: [],
            experience: null,
            notes: null,
            providerId: null,
            isTestUser: false,
            cohortName: 'default',
          },
        ]),
      },
      $transaction: vi.fn(),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result).toEqual({ approved: 0, skipped: 1, errors: 0 })
    expect(mockFindConflictingActiveProviderApplications).not.toHaveBeenCalled()
    expect(mockSyncProviderRecord).not.toHaveBeenCalled()
    expect(mockReleaseOpsQueueItem).not.toHaveBeenCalled()
  })
})
