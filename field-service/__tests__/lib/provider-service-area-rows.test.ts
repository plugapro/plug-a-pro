import { describe, expect, it } from 'vitest'
import {
  buildTechnicianServiceAreaRows,
  InvalidServiceAreaNodeError,
} from '@/lib/provider-service-area-rows'

const SUBURB = {
  id: 'node-sea-point',
  slug: 'western_cape__cape_town__cape_town_cbd__sea_point',
  label: 'Sea Point',
  nodeType: 'SUBURB',
  provinceKey: 'western_cape',
  cityKey: 'cape_town',
  regionKey: 'cape_town_cbd',
}

const REGION = {
  id: 'node-ct-cbd',
  slug: 'western_cape__cape_town__cape_town_cbd',
  label: 'Cape Town CBD & Atlantic Seaboard',
  nodeType: 'REGION',
  provinceKey: 'western_cape',
  cityKey: 'cape_town',
  regionKey: 'cape_town_cbd',
}

describe('buildTechnicianServiceAreaRows', () => {
  it('builds an active SUBURB row with a suburbKey', () => {
    expect(buildTechnicianServiceAreaRows('prov-1', [SUBURB])).toEqual([
      {
        providerId: 'prov-1',
        locationNodeId: 'node-sea-point',
        areaType: 'SUBURB',
        label: 'Sea Point',
        provinceKey: 'western_cape',
        cityKey: 'cape_town',
        regionKey: 'cape_town_cbd',
        suburbKey: 'sea_point',
        active: true,
      },
    ])
  })

  it('builds an active REGION row with no suburbKey', () => {
    const [row] = buildTechnicianServiceAreaRows('prov-1', [REGION])
    expect(row).toMatchObject({
      providerId: 'prov-1',
      locationNodeId: 'node-ct-cbd',
      areaType: 'REGION',
      regionKey: 'cape_town_cbd',
      suburbKey: null,
      active: true,
    })
  })

  it('derives a REGION regionKey from the slug when the node has none', () => {
    const [row] = buildTechnicianServiceAreaRows('prov-1', [{ ...REGION, regionKey: null }])
    expect(row.regionKey).toBe('cape_town_cbd')
  })

  it('rejects CITY and PROVINCE nodes', () => {
    expect(() =>
      buildTechnicianServiceAreaRows('prov-1', [
        { ...REGION, id: 'node-city', nodeType: 'CITY', slug: 'western_cape__cape_town' },
      ]),
    ).toThrow(InvalidServiceAreaNodeError)
  })

  it('returns no rows for no nodes', () => {
    expect(buildTechnicianServiceAreaRows('prov-1', [])).toEqual([])
  })
})
