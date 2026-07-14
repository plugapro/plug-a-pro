import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCities,
  getRegions,
  getSuburbs,
  getStructuredAddressSelection,
  resolveStructuredAddressByLabels,
  resolveStructuredAddressFromReverse,
  searchNodes,
  resolveSuburbNodeId,
  isSuburbChildOfRegion,
  createLocationNode,
  updateLocationNode,
  deactivateLocationNode,
  deleteLocationNode,
  LocationNodeInUseError,
} from '../../lib/location-nodes'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    locationNode: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    address: {
      count: vi.fn(),
    },
    technicianServiceArea: {
      count: vi.fn(),
    },
  },
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

describe('getCities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns mapped CityOption[] from DB results', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([
      { id: 'node-1', slug: 'cape-town', label: 'Cape Town', provinceKey: 'western_cape', cityKey: 'cape_town' },
      { id: 'node-2', slug: 'johannesburg', label: 'Johannesburg', provinceKey: 'gauteng', cityKey: 'johannesburg' },
    ])

    const result = await getCities()

    expect(result).toEqual([
      { id: 'node-1', slug: 'cape-town', label: 'Cape Town', provinceKey: 'western_cape', cityKey: 'cape_town' },
      { id: 'node-2', slug: 'johannesburg', label: 'Johannesburg', provinceKey: 'gauteng', cityKey: 'johannesburg' },
    ])
    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ nodeType: 'CITY', active: true }) }),
    )
  })

  it('passes optional provinceKey filter to query', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([
      { id: 'node-1', slug: 'cape-town', label: 'Cape Town', provinceKey: 'western_cape', cityKey: 'cape_town' },
    ])

    await getCities('western_cape')

    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provinceKey: 'western_cape' }),
      }),
    )
  })

  it('coerces null provinceKey/cityKey to empty string', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([
      { id: 'node-1', slug: 'test', label: 'Test', provinceKey: null, cityKey: null },
    ])

    const result = await getCities()
    expect(result[0].provinceKey).toBe('')
    expect(result[0].cityKey).toBe('')
  })
})

describe('getRegions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves cityKey first, then fetches REGION nodes', async () => {
    mockDb.locationNode.findUnique.mockResolvedValue({ cityKey: 'cape_town', provinceKey: 'western_cape' })
    mockDb.locationNode.findMany.mockResolvedValue([
      {
        id: 'region-1',
        slug: 'atlantic-seaboard',
        label: 'Atlantic Seaboard',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: 'atlantic_seaboard',
        lat: -33.9,
        lng: 18.4,
        radiusKm: 5,
        _count: { children: 12 },
      },
    ])

    const result = await getRegions('city-node-1')

    expect(mockDb.locationNode.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'city-node-1' } }),
    )
    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nodeType: 'REGION', cityKey: 'cape_town' }),
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'region-1',
      label: 'Atlantic Seaboard',
      suburbCount: 12,
    })
  })

  it('returns [] when city node not found', async () => {
    mockDb.locationNode.findUnique.mockResolvedValue(null)

    const result = await getRegions('missing-id')

    expect(result).toEqual([])
    expect(mockDb.locationNode.findMany).not.toHaveBeenCalled()
  })

  it('returns [] when city node has no cityKey', async () => {
    mockDb.locationNode.findUnique.mockResolvedValue({ cityKey: null, provinceKey: 'western_cape' })

    const result = await getRegions('city-node-no-key')

    expect(result).toEqual([])
    expect(mockDb.locationNode.findMany).not.toHaveBeenCalled()
  })
})

describe('getSuburbs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only structured-capture-ready suburbs with parent labels and postal code', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([
      {
        id: 'suburb-1',
        slug: 'gauteng__johannesburg__jhb_north__sandton',
        label: 'Sandton',
        postalCode: '2196',
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_north',
        lat: -26.1,
        lng: 28.0,
        parent: {
          label: 'JHB North / Sandton',
          parent: {
            label: 'Johannesburg',
            parent: { label: 'Gauteng' },
          },
        },
      },
    ])

    const result = await getSuburbs('region-1')

    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          nodeType: 'SUBURB',
          parentId: 'region-1',
          postalCode: { not: null },
        }),
      }),
    )
    expect(result).toEqual([
      {
        id: 'suburb-1',
        slug: 'gauteng__johannesburg__jhb_north__sandton',
        label: 'Sandton',
        regionLabel: 'JHB North / Sandton',
        cityLabel: 'Johannesburg',
        provinceLabel: 'Gauteng',
        postalCode: '2196',
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_north',
        serviceStatus: 'onboarding',
        lat: -26.1,
        lng: 28.0,
      },
    ])
  })

  it('excludes broad alias nodes from structured suburb capture', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([])

    await getSuburbs('region-1')

    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: expect.objectContaining({
            notIn: expect.arrayContaining([
              'gauteng__johannesburg__jhb_cbd__johannesburg',
              'western_cape__cape_town__cape_town_cbd__cape_town',
            ]),
          }),
        }),
      }),
    )
  })
})

describe('searchNodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when query is shorter than 2 characters', async () => {
    await expect(searchNodes('a')).rejects.toThrow('Search query must be at least 2 characters')
    await expect(searchNodes('')).rejects.toThrow('Search query must be at least 2 characters')
  })

  it('calls findMany with insensitive contains when query is valid', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([])

    await searchNodes('sand')

    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ label: { contains: 'sand', mode: 'insensitive' } }],
          nodeType: { in: ['SUBURB', 'REGION'] },
          active: true,
        }),
        take: 20,
      }),
    )
  })

  it('passes optional provinceKey filter to query', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([])

    await searchNodes('sand', 'gauteng')

    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ provinceKey: 'gauteng' }),
      }),
    )
  })

  it('returns display-normalised labels without changing the search query', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([
      {
        id: 'sub-ruimsig',
        slug: 'gauteng__johannesburg__jhb_west__ruimsig',
        label: 'ruimsig',
        nodeType: 'SUBURB',
        provinceKey: 'gauteng',
        cityKey: 'johannesburg',
        regionKey: 'jhb_west',
      },
    ])

    const result = await searchNodes('ruim')

    expect(result[0].label).toBe('Ruimsig')
    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ label: { contains: 'ruim', mode: 'insensitive' } }],
        }),
      }),
    )
  })
})

describe('resolveSuburbNodeId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns node id when found', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue({ id: 'suburb-node-1' })

    const result = await resolveSuburbNodeId('Sandton')

    expect(result).toBe('suburb-node-1')
    expect(mockDb.locationNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          label: { equals: 'Sandton', mode: 'insensitive' },
          nodeType: 'SUBURB',
          active: true,
        }),
      }),
    )
  })

  it('returns null when not found', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue(null)

    const result = await resolveSuburbNodeId('NonexistentSuburb')

    expect(result).toBeNull()
  })

  it('passes optional city filter to query', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue({ id: 'suburb-node-1' })

    await resolveSuburbNodeId('Sandton', 'johannesburg')

    expect(mockDb.locationNode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cityKey: { equals: 'johannesburg', mode: 'insensitive' },
        }),
      }),
    )
  })
})

describe('getStructuredAddressSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns structured suburb selection when node is valid for capture', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue({
      id: 'suburb-1',
      label: 'Sandton',
      postalCode: '2196',
      parent: {
        label: 'JHB North / Sandton',
        parent: {
          label: 'Johannesburg',
          parent: { label: 'Gauteng' },
        },
      },
    })

    const result = await getStructuredAddressSelection('suburb-1')

    expect(result).toEqual({
      locationNodeId: 'suburb-1',
      suburb: 'Sandton',
      region: 'JHB North / Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
    })
  })

  it('normalises lowercase structured address labels before returning them', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue({
      id: 'suburb-1',
      label: 'ruimsig',
      postalCode: '1724',
      parent: {
        label: 'jhb west',
        parent: {
          label: 'johannesburg',
          parent: { label: 'gauteng' },
        },
      },
    })

    const result = await getStructuredAddressSelection('suburb-1')

    expect(result).toEqual(expect.objectContaining({
      suburb: 'Ruimsig',
      region: 'JHB West',
      city: 'Johannesburg',
      province: 'Gauteng',
    }))
  })
})

describe('resolveStructuredAddressByLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters exact suburb label matches by city and province', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([
      {
        id: 'suburb-1',
        label: 'Morningside',
        postalCode: '2196',
        parent: {
          label: 'JHB North / Sandton',
          parent: {
            label: 'Johannesburg',
            parent: { label: 'Gauteng' },
          },
        },
      },
      {
        id: 'suburb-2',
        label: 'Morningside',
        postalCode: '4001',
        parent: {
          label: 'Durban CBD',
          parent: {
            label: 'Durban',
            parent: { label: 'KwaZulu-Natal' },
          },
        },
      },
    ])

    const result = await resolveStructuredAddressByLabels({
      suburb: 'Morningside',
      city: 'Johannesburg',
      province: 'Gauteng',
    })

    expect(result?.locationNodeId).toBe('suburb-1')
    expect(mockDb.locationNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          label: { equals: 'Morningside', mode: 'insensitive' },
          postalCode: { not: null },
        }),
      }),
    )
  })
})

describe('createLocationNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PROVINCE with parentId = null creates successfully', async () => {
    const mockNode = { id: 'prov-1', nodeType: 'PROVINCE', slug: 'western-cape', label: 'Western Cape' }
    mockDb.locationNode.create.mockResolvedValue(mockNode)

    const result = await createLocationNode({
      nodeType: 'PROVINCE',
      slug: 'western-cape',
      label: 'Western Cape',
      parentId: null,
    })

    expect(result).toEqual(mockNode)
    expect(mockDb.locationNode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nodeType: 'PROVINCE', parentId: null }),
      }),
    )
  })

  it('normalises location labels before creating reference data', async () => {
    mockDb.locationNode.findUnique.mockResolvedValue({ nodeType: 'REGION' })
    mockDb.locationNode.create.mockResolvedValue({ id: 'sub-ruimsig', label: 'Ruimsig' })

    await createLocationNode({
      nodeType: 'SUBURB',
      slug: 'gauteng__johannesburg__jhb_west__ruimsig',
      label: 'ruimsig',
      parentId: 'region-1',
    })

    expect(mockDb.locationNode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ label: 'Ruimsig' }),
      }),
    )
  })

  it('PROVINCE with non-null parentId throws validation error', async () => {
    await expect(
      createLocationNode({
        nodeType: 'PROVINCE',
        slug: 'western-cape',
        label: 'Western Cape',
        parentId: 'some-parent',
      }),
    ).rejects.toThrow('PROVINCE nodes must have parentId = null')
  })

  it('SUBURB validates parent type - throws on wrong parent type', async () => {
    // Parent is a CITY node, but SUBURB expects REGION parent
    mockDb.locationNode.findUnique.mockResolvedValue({ nodeType: 'CITY' })

    await expect(
      createLocationNode({
        nodeType: 'SUBURB',
        slug: 'test-suburb',
        label: 'Test Suburb',
        parentId: 'city-node-1',
      }),
    ).rejects.toThrow('SUBURB requires a REGION parent, got CITY')
  })

  it('non-PROVINCE node without parentId throws', async () => {
    await expect(
      createLocationNode({
        nodeType: 'CITY',
        slug: 'cape-town',
        label: 'Cape Town',
        parentId: null,
      }),
    ).rejects.toThrow('CITY nodes require a parentId')
  })

  it('throws when parent node is not found', async () => {
    mockDb.locationNode.findUnique.mockResolvedValue(null)

    await expect(
      createLocationNode({
        nodeType: 'CITY',
        slug: 'cape-town',
        label: 'Cape Town',
        parentId: 'missing-parent',
      }),
    ).rejects.toThrow('Parent node missing-parent not found')
  })
})

describe('deactivateLocationNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls update with active: false', async () => {
    mockDb.locationNode.update.mockResolvedValue({ id: 'node-1', active: false })

    await deactivateLocationNode('node-1')

    expect(mockDb.locationNode.update).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: { active: false },
    })
  })
})

describe('deleteLocationNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ALLOW_LOCATION_HARD_DELETE
  })

  it('soft-deactivates by default because location reference data is protected', async () => {
    mockDb.locationNode.update.mockResolvedValue({ id: 'node-1', active: false })

    await deleteLocationNode('node-1')

    expect(mockDb.locationNode.update).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: { active: false },
    })
    expect(mockDb.locationNode.delete).not.toHaveBeenCalled()
  })

  it('throws LocationNodeInUseError when hard delete is explicitly enabled and node has children', async () => {
    process.env.ALLOW_LOCATION_HARD_DELETE = 'true'
    mockDb.locationNode.count.mockResolvedValue(3)
    mockDb.address.count.mockResolvedValue(0)
    mockDb.technicianServiceArea.count.mockResolvedValue(0)

    await expect(deleteLocationNode('node-1')).rejects.toThrow(LocationNodeInUseError)
    await expect(deleteLocationNode('node-1')).rejects.toThrow('child node')
  })

  it('throws LocationNodeInUseError when hard delete is explicitly enabled and node has address references', async () => {
    process.env.ALLOW_LOCATION_HARD_DELETE = 'true'
    mockDb.locationNode.count.mockResolvedValue(0)
    mockDb.address.count.mockResolvedValue(2)
    mockDb.technicianServiceArea.count.mockResolvedValue(0)

    await expect(deleteLocationNode('node-1')).rejects.toThrow(LocationNodeInUseError)
    await expect(deleteLocationNode('node-1')).rejects.toThrow('address')
  })

  it('throws LocationNodeInUseError when hard delete is explicitly enabled and node has service area references', async () => {
    process.env.ALLOW_LOCATION_HARD_DELETE = 'true'
    mockDb.locationNode.count.mockResolvedValue(0)
    mockDb.address.count.mockResolvedValue(0)
    mockDb.technicianServiceArea.count.mockResolvedValue(1)

    await expect(deleteLocationNode('node-1')).rejects.toThrow(LocationNodeInUseError)
  })

  it('hard-deletes only when explicitly enabled and no references exist', async () => {
    process.env.ALLOW_LOCATION_HARD_DELETE = 'true'
    mockDb.locationNode.count.mockResolvedValue(0)
    mockDb.address.count.mockResolvedValue(0)
    mockDb.technicianServiceArea.count.mockResolvedValue(0)
    mockDb.locationNode.delete.mockResolvedValue({ id: 'node-1' })

    await deleteLocationNode('node-1')

    expect(mockDb.locationNode.delete).toHaveBeenCalledWith({ where: { id: 'node-1' } })
  })
})

describe('updateLocationNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls update with provided fields only', async () => {
    mockDb.locationNode.update.mockResolvedValue({ id: 'node-1', label: 'Greenstone Hill' })

    await updateLocationNode('node-1', { label: 'greenstone hill' })

    expect(mockDb.locationNode.update).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: { label: 'Greenstone Hill' },
    })
  })
})

describe('isSuburbChildOfRegion (finding 3cc92366 anti-spoof)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when the active suburb node is a direct child of the region', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue({ parentId: 'rgn-1' })

    await expect(isSuburbChildOfRegion('sub-1', 'rgn-1')).resolves.toBe(true)
    expect(mockDb.locationNode.findFirst).toHaveBeenCalledWith({
      where: { id: 'sub-1', nodeType: 'SUBURB', active: true },
      select: { parentId: true },
    })
  })

  it('returns false when the suburb parent does not match the expected region', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue({ parentId: 'rgn-other' })

    await expect(isSuburbChildOfRegion('sub-1', 'rgn-1')).resolves.toBe(false)
  })

  it('returns false when the suburb node is missing or inactive', async () => {
    mockDb.locationNode.findFirst.mockResolvedValue(null)

    await expect(isSuburbChildOfRegion('sub-1', 'rgn-1')).resolves.toBe(false)
  })

  it('returns false (no DB call) when either id is empty', async () => {
    await expect(isSuburbChildOfRegion('', 'rgn-1')).resolves.toBe(false)
    await expect(isSuburbChildOfRegion('sub-1', null)).resolves.toBe(false)
    expect(mockDb.locationNode.findFirst).not.toHaveBeenCalled()
  })
})

describe('resolveStructuredAddressFromReverse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function suburbNode(opts: {
    id: string
    label: string
    postalCode: string | null
    lat?: number | null
    lng?: number | null
    region: string
    city: string
    province: string
  }) {
    return {
      id: opts.id,
      label: opts.label,
      postalCode: opts.postalCode,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      parent: {
        label: opts.region,
        parent: { label: opts.city, parent: { label: opts.province } },
      },
    }
  }

  it('uses the exact suburb-name match first (unchanged precise path)', async () => {
    mockDb.locationNode.findMany.mockResolvedValueOnce([
      suburbNode({ id: 'n1', label: 'Sandton', postalCode: '2196', region: 'Sandton', city: 'Johannesburg', province: 'Gauteng' }),
    ])

    const sel = await resolveStructuredAddressFromReverse({ suburb: 'Sandton', city: 'Johannesburg', province: 'Gauteng' })

    expect(sel?.suburb).toBe('Sandton')
    expect(sel?.postalCode).toBe('2196')
    expect(mockDb.locationNode.findMany).toHaveBeenCalledTimes(1)
  })

  it('falls back to postal code when the OSM suburb name does not match', async () => {
    mockDb.locationNode.findMany
      .mockResolvedValueOnce([]) // exact-name query: no match
      .mockResolvedValueOnce([
        suburbNode({ id: 'lf', label: 'Little Falls', postalCode: '2040', lat: -26.13, lng: 27.88, region: 'Roodepoort', city: 'Johannesburg', province: 'Gauteng' }),
      ]) // postal-code query

    const sel = await resolveStructuredAddressFromReverse({
      suburb: 'Little Falls Ext 1',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2040',
      lat: -26.13,
      lng: 27.88,
    })

    expect(sel?.suburb).toBe('Little Falls')
    expect(sel?.postalCode).toBe('2040')
    expect(mockDb.locationNode.findMany).toHaveBeenCalledTimes(2)
  })

  it('disambiguates a shared postal code by nearest coordinate', async () => {
    mockDb.locationNode.findMany.mockResolvedValueOnce([
      suburbNode({ id: 'far', label: 'Far Suburb', postalCode: '2000', lat: -26.30, lng: 28.10, region: 'R1', city: 'C1', province: 'Gauteng' }),
      suburbNode({ id: 'near', label: 'Near Suburb', postalCode: '2000', lat: -26.205, lng: 28.045, region: 'R2', city: 'C2', province: 'Gauteng' }),
    ])

    const sel = await resolveStructuredAddressFromReverse({ postalCode: '2000', lat: -26.20, lng: 28.04, province: 'Gauteng' })

    expect(sel?.suburb).toBe('Near Suburb')
    expect(mockDb.locationNode.findMany).toHaveBeenCalledTimes(1)
  })

  it('falls back to nearest suburb by coordinate within the province', async () => {
    mockDb.locationNode.findMany.mockResolvedValueOnce([
      suburbNode({ id: 'a', label: 'Alpha', postalCode: '1', lat: -26.30, lng: 28.30, region: 'R', city: 'C', province: 'Gauteng' }),
      suburbNode({ id: 'b', label: 'Beta', postalCode: '2', lat: -26.205, lng: 28.045, region: 'R', city: 'C', province: 'Gauteng' }),
    ])

    const sel = await resolveStructuredAddressFromReverse({ province: 'Gauteng', lat: -26.20, lng: 28.04 })

    expect(sel?.suburb).toBe('Beta')
  })

  it('returns null when the nearest coordinate candidate is beyond the max distance', async () => {
    mockDb.locationNode.findMany.mockResolvedValueOnce([
      suburbNode({ id: 'far', label: 'Far', postalCode: '9', lat: -25.0, lng: 29.0, region: 'R', city: 'C', province: 'Gauteng' }),
    ])

    const sel = await resolveStructuredAddressFromReverse({ province: 'Gauteng', lat: -26.20, lng: 28.04 })

    expect(sel).toBeNull()
  })

  it('returns null when no signal resolves a suburb', async () => {
    mockDb.locationNode.findMany.mockResolvedValue([])

    const sel = await resolveStructuredAddressFromReverse({ suburb: 'Nowhere Place' })

    expect(sel).toBeNull()
  })
})
