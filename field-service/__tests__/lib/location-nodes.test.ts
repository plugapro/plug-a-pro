import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCities,
  getRegions,
  searchNodes,
  resolveSuburbNodeId,
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
          label: { contains: 'sand', mode: 'insensitive' },
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

  it('SUBURB validates parent type — throws on wrong parent type', async () => {
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
  })

  it('throws LocationNodeInUseError when node has children', async () => {
    mockDb.locationNode.count.mockResolvedValue(3)
    mockDb.address.count.mockResolvedValue(0)
    mockDb.technicianServiceArea.count.mockResolvedValue(0)

    await expect(deleteLocationNode('node-1')).rejects.toThrow(LocationNodeInUseError)
    await expect(deleteLocationNode('node-1')).rejects.toThrow('child node')
  })

  it('throws LocationNodeInUseError when node has address references', async () => {
    mockDb.locationNode.count.mockResolvedValue(0)
    mockDb.address.count.mockResolvedValue(2)
    mockDb.technicianServiceArea.count.mockResolvedValue(0)

    await expect(deleteLocationNode('node-1')).rejects.toThrow(LocationNodeInUseError)
    await expect(deleteLocationNode('node-1')).rejects.toThrow('address')
  })

  it('throws LocationNodeInUseError when node has service area references', async () => {
    mockDb.locationNode.count.mockResolvedValue(0)
    mockDb.address.count.mockResolvedValue(0)
    mockDb.technicianServiceArea.count.mockResolvedValue(1)

    await expect(deleteLocationNode('node-1')).rejects.toThrow(LocationNodeInUseError)
  })

  it('deletes node when no references exist', async () => {
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
    mockDb.locationNode.update.mockResolvedValue({ id: 'node-1', label: 'New Label' })

    await updateLocationNode('node-1', { label: 'New Label' })

    expect(mockDb.locationNode.update).toHaveBeenCalledWith({
      where: { id: 'node-1' },
      data: { label: 'New Label' },
    })
  })
})
