// autoApproveProviderApplications must NOT promote a provider to verified=true /
// status=ACTIVE without a passing KYC gate when provider.kyc.required_for_activation
// is ON. These tests pin the wiring; the underlying gate logic is unit-tested
// in provider-lead-eligibility.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAwardPromoCreditsForMilestone,
  mockCheckJobsForNewProviderAvailability,
  mockFindConflictingActiveProviderApplications,
  mockIsEnabled,
  mockIsKycRequired,
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
  mockIsKycRequired: vi.fn(),
  mockNotifyProviderApplicationApprovedOnce: vi.fn(),
  mockRecordAuditLog: vi.fn(),
  mockReleaseOpsQueueItem: vi.fn(),
  mockResolveServiceCategoryTag: vi.fn(),
  mockSyncProviderRecord: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/kyc-policy', () => ({
  isKycRequiredForActivation: mockIsKycRequired,
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
    { tag: 'handyman', label: 'Handyman' },
  ],
  resolveServiceCategoryTag: mockResolveServiceCategoryTag,
}))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mockRecordAuditLog }))

import { autoApproveProviderApplications } from '@/lib/provider-auto-approve'

const baseApp = {
  id: 'app-new-1',
  phone: '+27820000111',
  name: 'New Provider',
  skills: ['Handyman'],
  serviceAreas: ['Roodepoort'],
  experience: '5 years',
  notes: null,
  providerId: null, // brand-new application with no provider yet
  isTestUser: false,
  cohortName: null,
}

beforeEach(() => {
  mockIsEnabled.mockReset().mockResolvedValue(true) // auto-approve kill switch ON; grace flag ON
  mockIsKycRequired.mockReset()
  mockSyncProviderRecord.mockReset().mockResolvedValue('provider-1')
  mockFindConflictingActiveProviderApplications.mockReset().mockResolvedValue([])
  mockReleaseOpsQueueItem.mockReset().mockResolvedValue({ count: 1 })
  mockResolveServiceCategoryTag.mockReset().mockReturnValue(undefined)
  mockRecordAuditLog.mockReset().mockResolvedValue(undefined)
})

describe('autoApproveProviderApplications — KYC gate', () => {
  it('approves as before when KYC is NOT required', async () => {
    mockIsKycRequired.mockResolvedValue(false)

    const tx = {
      providerApplication: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      providerCategory: { createMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([baseApp]),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(mockIsKycRequired).toHaveBeenCalled()
    expect(result.approved).toBe(1)
    expect(result.skippedReasons).not.toContain('NEEDS_KYC')
  })

  it('skips with NEEDS_KYC reason when KYC is required and provider has no linked record', async () => {
    mockIsKycRequired.mockResolvedValue(true)

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([baseApp]),
      },
      $transaction: vi.fn(),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result.approved).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skippedReasons).toContain('NEEDS_KYC')
    // The transaction must NOT have been entered — the provider was never written.
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it('skips when KYC required and linked provider is NOT_STARTED post-cutoff', async () => {
    mockIsKycRequired.mockResolvedValue(true)
    const appWithProvider = { ...baseApp, providerId: 'prov_post_cutoff' }

    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([appWithProvider]),
      },
      provider: {
        findUnique: vi.fn().mockResolvedValue({
          kycStatus: 'NOT_STARTED',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          kycGraceUntil: null,
          kycOverriddenAt: null,
        }),
      },
      $transaction: vi.fn(),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result.skipped).toBe(1)
    expect(result.skippedReasons).toContain('NEEDS_KYC')
    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it('approves when KYC required and linked provider is VERIFIED', async () => {
    mockIsKycRequired.mockResolvedValue(true)
    const appWithProvider = { ...baseApp, providerId: 'prov_verified' }

    const tx = {
      providerApplication: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      providerCategory: { createMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([appWithProvider]),
      },
      provider: {
        findUnique: vi.fn().mockResolvedValue({
          kycStatus: 'VERIFIED',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          kycGraceUntil: null,
          kycOverriddenAt: null,
        }),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result.approved).toBe(1)
  })

  it('approves when KYC required and admin override is set', async () => {
    mockIsKycRequired.mockResolvedValue(true)
    const appWithProvider = { ...baseApp, providerId: 'prov_override' }

    const tx = {
      providerApplication: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      providerCategory: { createMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const client: any = {
      providerApplication: {
        findMany: vi.fn().mockResolvedValue([appWithProvider]),
      },
      provider: {
        findUnique: vi.fn().mockResolvedValue({
          kycStatus: 'NOT_STARTED',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          kycGraceUntil: null,
          kycOverriddenAt: new Date('2026-06-18T00:00:00.000Z'),
        }),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(tx)),
    }

    const result = await autoApproveProviderApplications(client)

    expect(result.approved).toBe(1)
  })
})
