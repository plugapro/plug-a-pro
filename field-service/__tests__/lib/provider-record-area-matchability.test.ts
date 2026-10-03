import { describe, it, expect, vi } from 'vitest'
import { upsertStructuredServiceAreas } from '@/lib/provider-record'

function makeClient(nodes: Array<Record<string, unknown>>) {
  const upsert = vi.fn().mockResolvedValue({})
  const client = {
    locationNode: { findMany: vi.fn().mockResolvedValue(nodes) },
    technicianServiceArea: { upsert },
  }
  return { client, upsert }
}

describe('upsertStructuredServiceAreas — national liveness contract', () => {
  it.each([
    ['jhb_north', 'gauteng__johannesburg__jhb_north__sandton', 'Sandton', 'gauteng', 'johannesburg'],
    ['jhb_west', 'gauteng__johannesburg__jhb_west__florida', 'Florida', 'gauteng', 'johannesburg'],
    ['cape_town_cbd', 'western_cape__cape_town__cape_town_cbd__sea_point', 'Sea Point', 'western_cape', 'cape_town'],
    ['kimberley', 'northern_cape__kimberley__kimberley__galeshewe', 'Galeshewe', 'northern_cape', 'kimberley'],
  ])('writes an ACTIVE SUBURB row for region %s', async (regionKey, slug, label, provinceKey, cityKey) => {
    const { client, upsert } = makeClient([
      { id: 'node-1', nodeType: 'SUBURB', slug, label, regionKey, provinceKey, cityKey },
    ])
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['node-1'])
    const suburbKey = slug.split('__').at(-1)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_locationNodeId: { providerId: 'prov-1', locationNodeId: 'node-1' } },
        create: expect.objectContaining({ active: true, areaType: 'SUBURB', regionKey, suburbKey, label, provinceKey, cityKey }),
        update: expect.objectContaining({ active: true, areaType: 'SUBURB', regionKey, suburbKey, label, provinceKey, cityKey }),
      }),
    )
  })

  it('writes an ACTIVE REGION row (areaType REGION, suburbKey null, locationNodeId = region node)', async () => {
    const { client, upsert } = makeClient([
      {
        id: 'region-1',
        nodeType: 'REGION',
        slug: 'northern_cape__kimberley__kimberley',
        label: 'Kimberley',
        regionKey: 'kimberley',
        provinceKey: 'northern_cape',
        cityKey: 'kimberley',
      },
    ])
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['region-1'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId_locationNodeId: { providerId: 'prov-1', locationNodeId: 'region-1' } },
        create: expect.objectContaining({
          active: true,
          areaType: 'REGION',
          regionKey: 'kimberley',
          suburbKey: null,
          label: 'Kimberley',
          locationNodeId: 'region-1',
        }),
        update: expect.objectContaining({ active: true, areaType: 'REGION', regionKey: 'kimberley', suburbKey: null }),
      }),
    )
  })

  it('derives regionKey from the slug when a REGION node carries no regionKey', async () => {
    const { client, upsert } = makeClient([
      {
        id: 'region-2',
        nodeType: 'REGION',
        slug: 'kwazulu_natal__durban__durban_north',
        label: 'Durban North',
        regionKey: null,
        provinceKey: 'kwazulu_natal',
        cityKey: 'durban',
      },
    ])
    await upsertStructuredServiceAreas(client as never, 'prov-1', ['region-2'])
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ active: true, areaType: 'REGION', regionKey: 'durban_north' }),
      }),
    )
  })

  it('writes nothing for an empty node list', async () => {
    const { client, upsert } = makeClient([])
    await upsertStructuredServiceAreas(client as never, 'prov-1', [])
    expect(upsert).not.toHaveBeenCalled()
    expect(client.locationNode.findMany).not.toHaveBeenCalled()
  })
})
