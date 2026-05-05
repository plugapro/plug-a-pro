import { describe, expect, it } from 'vitest'
import { auditLocationReferenceData } from '@/lib/location-audit'

function prismaWith(params: {
  provinces: number
  cities: number
  regions: number
  suburbs: number
  inactive?: number
  roodepoortRegion?: { id: string; label: string; active: boolean } | null
  roodepoortLabels?: string[]
}) {
  return {
    locationNode: {
      count: async ({ where }: any) => {
        if (where?.active === false) return params.inactive ?? 0
        if (where?.nodeType === 'PROVINCE') return params.provinces
        if (where?.nodeType === 'CITY') return params.cities
        if (where?.nodeType === 'REGION') return params.regions
        if (where?.nodeType === 'SUBURB') return params.suburbs
        return 0
      },
      findUnique: async () => params.roodepoortRegion ?? null,
      findMany: async () => (params.roodepoortLabels ?? []).map((label) => ({ label })),
    },
  } as any
}

const requiredRoodepoortLabels = [
  'Roodepoort',
  'Florida',
  'Discovery',
  'Little Falls',
  'Radiokop',
  'Ruimsig',
  'Strubens Valley',
  'Weltevreden Park',
  'Wilgeheuwel',
  'Randpark Ridge',
  'Bromhof',
  'Honeydew',
  'Constantia Kloof',
  'Horison',
  'Helderkruin',
  'Wilro Park',
  'Witpoortjie',
  "Allen's Nek",
  'Kloofendal',
  'Featherbrooke',
  'Laser Park',
  'Northcliff',
]

describe('auditLocationReferenceData', () => {
  it('passes when master data counts and required Roodepoort suburbs are present', async () => {
    const audit = await auditLocationReferenceData(prismaWith({
      provinces: 9,
      cities: 15,
      regions: 24,
      suburbs: 253,
      roodepoortRegion: { id: 'region-1', label: 'JHB West / Roodepoort', active: true },
      roodepoortLabels: requiredRoodepoortLabels,
    }))

    expect(audit.ok).toBe(true)
    expect(audit.failures).toEqual([])
  })

  it('fails loudly when counts drop or required Roodepoort data is missing', async () => {
    const audit = await auditLocationReferenceData(prismaWith({
      provinces: 8,
      cities: 10,
      regions: 20,
      suburbs: 100,
      roodepoortRegion: null,
      roodepoortLabels: ['Roodepoort'],
    }))

    expect(audit.ok).toBe(false)
    expect(audit.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('Expected at least 9 active provinces'),
      expect.stringContaining('JHB West / Roodepoort region is missing'),
      expect.stringContaining('Required Roodepoort suburb missing: Florida'),
    ]))
  })
})
