import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockResolveAreaScope, mockListServiceable, mockCountActive, mockUnstableCache } =
  vi.hoisted(() => ({
    mockDb: {
      job: { count: vi.fn() },
      provider: { count: vi.fn() },
    },
    mockResolveAreaScope: vi.fn(),
    mockListServiceable: vi.fn(),
    mockCountActive: vi.fn(),
    mockUnstableCache: vi.fn(),
  }))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/db', () => ({ db: mockDb }))
vi.mock('../../lib/customer-serviceability', () => ({
  resolveAreaScope: mockResolveAreaScope,
  listServiceableCategoriesForArea: mockListServiceable,
  countActiveProvidersFor: mockCountActive,
}))
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown, keys: string[], opts: unknown) => {
    mockUnstableCache(keys, opts)
    return fn
  },
}))

import {
  CUSTOMER_HOME_SNAPSHOT_TAG,
  CUSTOMER_HOME_SNAPSHOT_TTL_SECONDS,
  getCustomerHomeSnapshot,
  loadCustomerHomeSnapshot,
} from '../../lib/customer-home-snapshot'

const AREA = { nodeId: 'node-1', slug: 'jhb-west' }

describe('loadCustomerHomeSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAreaScope.mockResolvedValue(AREA)
    mockListServiceable.mockResolvedValue([{ tag: 'handyman', label: 'Handyman', activeProviderCount: 3 }])
    mockCountActive.mockResolvedValue(12)
    mockDb.job.count.mockResolvedValue(7)
    mockDb.provider.count.mockResolvedValue(99)
  })

  it('scopes the provider count to the resolved area when serviceability v2 is on', async () => {
    const snapshot = await loadCustomerHomeSnapshot('jhb-west', true)

    expect(snapshot).toEqual({
      areaScope: AREA,
      serviceableCategories: [{ tag: 'handyman', label: 'Handyman', activeProviderCount: 3 }],
      completedJobsCount: 7,
      verifiedProviderCount: 12,
    })
    expect(mockCountActive).toHaveBeenCalledWith({ area: AREA })
    expect(mockDb.provider.count).not.toHaveBeenCalled()
  })

  it('falls back to the platform-wide count when serviceability v2 is off', async () => {
    const snapshot = await loadCustomerHomeSnapshot('jhb-west', false)

    expect(snapshot.areaScope).toBeNull()
    expect(snapshot.serviceableCategories).toEqual([])
    expect(snapshot.verifiedProviderCount).toBe(99)
    expect(mockResolveAreaScope).not.toHaveBeenCalled()
    expect(mockCountActive).not.toHaveBeenCalled()
  })

  it('uses the platform count when v2 is on but the area does not resolve', async () => {
    mockResolveAreaScope.mockResolvedValue(null)

    const snapshot = await loadCustomerHomeSnapshot('nowhere', true)

    expect(snapshot.areaScope).toBeNull()
    expect(snapshot.verifiedProviderCount).toBe(99)
  })

  it('degrades to zeros rather than failing the page when the counts throw', async () => {
    mockDb.job.count.mockRejectedValue(new Error('db down'))

    const snapshot = await loadCustomerHomeSnapshot('jhb-west', true)

    expect(snapshot.completedJobsCount).toBe(0)
    expect(snapshot.verifiedProviderCount).toBe(0)
  })

  it('still renders when serviceable categories fail to load', async () => {
    mockListServiceable.mockRejectedValue(new Error('timeout'))

    const snapshot = await loadCustomerHomeSnapshot('jhb-west', true)

    expect(snapshot.serviceableCategories).toEqual([])
  })
})

describe('getCustomerHomeSnapshot caching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveAreaScope.mockResolvedValue(AREA)
    mockListServiceable.mockResolvedValue([])
    mockCountActive.mockResolvedValue(1)
    mockDb.job.count.mockResolvedValue(0)
    mockDb.provider.count.mockResolvedValue(0)
  })

  it('caches per area and variant, with a short TTL and a revalidation tag', async () => {
    await getCustomerHomeSnapshot('JHB-West', true)

    expect(mockUnstableCache).toHaveBeenCalledWith(
      ['customer-home-snapshot', 'v2', 'jhb-west'],
      { revalidate: CUSTOMER_HOME_SNAPSHOT_TTL_SECONDS, tags: [CUSTOMER_HOME_SNAPSHOT_TAG] },
    )
    expect(CUSTOMER_HOME_SNAPSHOT_TTL_SECONDS).toBeLessThanOrEqual(600)
  })

  it('treats differently-cased area slugs as the same cache entry', async () => {
    await getCustomerHomeSnapshot('  Jhb-West ', true)
    expect(mockUnstableCache.mock.calls[0]![0]).toEqual(['customer-home-snapshot', 'v2', 'jhb-west'])
  })

  it('keeps a visitor with no area separate from an area-scoped visitor', async () => {
    await getCustomerHomeSnapshot(null, true)
    expect(mockUnstableCache.mock.calls[0]![0]).toEqual(['customer-home-snapshot', 'v2', '_none'])
  })

  it('does not share a cache entry between serviceability variants', async () => {
    await getCustomerHomeSnapshot('jhb-west', false)
    expect(mockUnstableCache.mock.calls[0]![0]).toEqual(['customer-home-snapshot', 'v1', 'jhb-west'])
  })

  it('reads through to the database when the cache layer is unavailable', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockUnstableCache.mockImplementationOnce(() => {
      throw new Error('Invariant: incrementalCache missing in unstable_cache')
    })

    const snapshot = await getCustomerHomeSnapshot('jhb-west', true)

    expect(snapshot.areaScope).toEqual(AREA)
    expect(consoleWarn).toHaveBeenCalledWith(
      '[customer-home-snapshot] cache unavailable, reading through',
      expect.objectContaining({ area: 'jhb-west', variant: 'v2' }),
    )
    consoleWarn.mockRestore()
  })
})
