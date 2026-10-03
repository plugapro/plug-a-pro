import { describe, it, expect } from 'vitest'
import { buildServiceAreaUpsert } from '../../scripts/backfill-tsa-from-legacy-service-areas'

describe('buildServiceAreaUpsert (legacy serviceAreas[] backfill)', () => {
  it('types a REGION node as a REGION row with suburbKey null', () => {
    const args = buildServiceAreaUpsert('prov-1', {
      id: 'region-1',
      nodeType: 'REGION',
      label: 'Kimberley',
      slug: 'northern_cape__kimberley__kimberley',
      regionKey: 'kimberley',
      provinceKey: 'northern_cape',
      cityKey: 'kimberley',
    })
    expect(args.where).toEqual({ providerId_locationNodeId: { providerId: 'prov-1', locationNodeId: 'region-1' } })
    expect(args.create).toMatchObject({
      providerId: 'prov-1',
      locationNodeId: 'region-1',
      areaType: 'REGION',
      suburbKey: null,
      regionKey: 'kimberley',
      active: true,
    })
    expect(args.update).toMatchObject({ areaType: 'REGION', suburbKey: null, regionKey: 'kimberley', active: true })
  })

  it('derives regionKey from the slug when a REGION node carries none', () => {
    const args = buildServiceAreaUpsert('prov-1', {
      id: 'region-2',
      nodeType: 'REGION',
      label: 'JHB North',
      slug: 'gauteng__johannesburg__jhb_north',
      regionKey: null,
      provinceKey: 'gauteng',
      cityKey: 'johannesburg',
    })
    expect(args.create).toMatchObject({ areaType: 'REGION', regionKey: 'jhb_north', suburbKey: null })
  })

  it('types a SUBURB node as a SUBURB row with the slug suburbKey', () => {
    const args = buildServiceAreaUpsert('prov-1', {
      id: 'node-1',
      nodeType: 'SUBURB',
      label: 'Sandton',
      slug: 'gauteng__johannesburg__jhb_north__sandton',
      regionKey: 'jhb_north',
      provinceKey: 'gauteng',
      cityKey: 'johannesburg',
    })
    expect(args.create).toMatchObject({ areaType: 'SUBURB', suburbKey: 'sandton', regionKey: 'jhb_north', label: 'Sandton', active: true })
    expect(args.update).toMatchObject({ areaType: 'SUBURB', suburbKey: 'sandton', regionKey: 'jhb_north', active: true })
  })
})
