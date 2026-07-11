import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// Mirrors the pattern in __tests__/app/admin/nudges-actions.test.ts: mock
// @/lib/crud-action directly so we control the `tx` object passed into each
// action's `run` closure, and spy on technicianServiceArea.upsert to assert
// matchability sync actually ran.

const { mockCrudAction, mockIsEnabled, mockResolveServiceAreaLabels } = vi.hoisted(() => ({
  mockCrudAction: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockResolveServiceAreaLabels: vi.fn(),
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
  crudAction: mockCrudAction,
  CrudActionError: MockCrudActionError,
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))

vi.mock('@/lib/provider-record/resolve-service-area-labels', () => ({
  resolveServiceAreaLabels: mockResolveServiceAreaLabels,
}))

vi.mock('@/lib/kyc-policy', () => ({ isKycRequiredForActivation: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/provider-lead-eligibility', () => ({ checkCanBeApproved: vi.fn().mockReturnValue({ ok: true }) }))
vi.mock('@/lib/provider-categories', () => ({ autoApproveLowRiskCategories: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/internal-test-cohort', () => ({ createTestCohortContext: vi.fn().mockReturnValue({ isTestUser: false, cohortName: null }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const PROVIDER_ID = 'provider-1'

function makeTx(overrides?: { serviceAreas?: string[] }) {
  const provider = {
    id: PROVIDER_ID,
    status: 'UNDER_REVIEW',
    kycStatus: 'NOT_STARTED',
    createdAt: new Date(),
    kycGraceUntil: null,
    kycOverriddenAt: null,
    serviceAreas: overrides?.serviceAreas ?? ['Roodepoort'],
  }

  return {
    provider: {
      findUnique: vi.fn(async () => provider),
      update: vi.fn(async () => ({ id: PROVIDER_ID })),
    },
    technicianServiceArea: {
      upsert: vi.fn(async () => ({})),
    },
    locationNode: {
      findMany: vi.fn(async () => [
        {
          id: 'node-1',
          nodeType: 'SUBURB',
          slug: 'gauteng__johannesburg__jhb_west__roodepoort',
          label: 'Roodepoort',
          provinceKey: 'gauteng',
          cityKey: 'johannesburg',
          regionKey: 'jhb_west',
        },
      ]),
    },
  }
}

// crudAction real implementation just calls the run closure with the given
// tx and wraps the result — mirrors production shape closely enough for
// these action-level tests.
function wireCrudAction(tx: ReturnType<typeof makeTx>) {
  mockCrudAction.mockImplementation(async (opts: any) => {
    const data = await opts.run(opts.input, tx)
    return { ok: true as const, data }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveServiceAreaLabels.mockResolvedValue({
    resolvedNodeIds: ['node-1'],
    unresolved: [],
    ambiguous: [],
  })
})

describe('provider admin actions — matchability sync (PJ-01)', () => {
  describe('flag ON', () => {
    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(true)
    })

    it('setProviderStatusAction syncs TSA rows when transitioning to ACTIVE', async () => {
      const tx = makeTx()
      wireCrudAction(tx)
      const { setProviderStatusAction } = await import('@/app/(admin)/admin/providers/actions')

      const result = await setProviderStatusAction({
        providerId: PROVIDER_ID,
        status: 'ACTIVE',
        reason: 'Approved after review',
      })

      expect(result.ok).toBe(true)
      expect(mockResolveServiceAreaLabels).toHaveBeenCalledWith(
        tx,
        ['Roodepoort'],
        { preferMajorityRegion: true },
      )
      expect(tx.technicianServiceArea.upsert).toHaveBeenCalled()
    })

    it('setProviderStatusAction does NOT sync TSA rows for a SUSPENDED transition', async () => {
      const tx = makeTx()
      wireCrudAction(tx)
      const { setProviderStatusAction } = await import('@/app/(admin)/admin/providers/actions')

      await setProviderStatusAction({
        providerId: PROVIDER_ID,
        status: 'SUSPENDED',
        reason: 'Complaint under investigation',
      })

      expect(mockResolveServiceAreaLabels).not.toHaveBeenCalled()
      expect(tx.technicianServiceArea.upsert).not.toHaveBeenCalled()
    })

    it('verifyProviderAction syncs TSA rows after setting verified', async () => {
      const tx = makeTx()
      wireCrudAction(tx)
      const { verifyProviderAction } = await import('@/app/(admin)/admin/providers/actions')

      const result = await verifyProviderAction(PROVIDER_ID)

      expect(result.ok).toBe(true)
      expect(tx.technicianServiceArea.upsert).toHaveBeenCalled()
    })

    it('updateProviderProfileAction syncs TSA rows after a serviceAreas change', async () => {
      // Existing serviceAreas ("Sandton") differ from the submitted value
      // ("Roodepoort") so the action's change-detection triggers the sync.
      const tx = makeTx({ serviceAreas: ['Sandton'] })
      wireCrudAction(tx)
      const { updateProviderProfileAction } = await import('@/app/(admin)/admin/providers/actions')

      const result = await updateProviderProfileAction({
        providerId: PROVIDER_ID,
        name: 'Test Provider',
        phone: '+27821234567',
        email: '',
        experience: '',
        skills: 'plumbing',
        serviceAreas: 'Roodepoort',
      })

      expect(result.ok).toBe(true)
      expect(tx.technicianServiceArea.upsert).toHaveBeenCalled()
    })

    it('updateProviderProfileAction does NOT sync TSA rows when serviceAreas is unchanged', async () => {
      const tx = makeTx({ serviceAreas: ['Roodepoort'] })
      wireCrudAction(tx)
      const { updateProviderProfileAction } = await import('@/app/(admin)/admin/providers/actions')

      const result = await updateProviderProfileAction({
        providerId: PROVIDER_ID,
        name: 'Test Provider',
        phone: '+27821234567',
        email: '',
        experience: '',
        skills: 'plumbing',
        serviceAreas: 'Roodepoort',
      })

      expect(result.ok).toBe(true)
      expect(mockResolveServiceAreaLabels).not.toHaveBeenCalled()
      expect(tx.technicianServiceArea.upsert).not.toHaveBeenCalled()
    })
  })

  describe('flag OFF', () => {
    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(false)
    })

    it('setProviderStatusAction does not sync TSA rows when the flag is OFF', async () => {
      const tx = makeTx()
      wireCrudAction(tx)
      const { setProviderStatusAction } = await import('@/app/(admin)/admin/providers/actions')

      const result = await setProviderStatusAction({
        providerId: PROVIDER_ID,
        status: 'ACTIVE',
        reason: 'Approved after review',
      })

      expect(result.ok).toBe(true)
      expect(mockResolveServiceAreaLabels).not.toHaveBeenCalled()
      expect(tx.technicianServiceArea.upsert).not.toHaveBeenCalled()
    })

    it('verifyProviderAction does not sync TSA rows when the flag is OFF', async () => {
      const tx = makeTx()
      wireCrudAction(tx)
      const { verifyProviderAction } = await import('@/app/(admin)/admin/providers/actions')

      await verifyProviderAction(PROVIDER_ID)

      expect(tx.technicianServiceArea.upsert).not.toHaveBeenCalled()
    })

    it('updateProviderProfileAction does not sync TSA rows when the flag is OFF', async () => {
      const tx = makeTx()
      wireCrudAction(tx)
      const { updateProviderProfileAction } = await import('@/app/(admin)/admin/providers/actions')

      await updateProviderProfileAction({
        providerId: PROVIDER_ID,
        name: 'Test Provider',
        phone: '+27821234567',
        email: '',
        experience: '',
        skills: 'plumbing',
        serviceAreas: 'Roodepoort',
      })

      expect(tx.technicianServiceArea.upsert).not.toHaveBeenCalled()
    })
  })
})
