import { describe, expect, it, beforeEach, vi } from 'vitest'
import { SA_PROVINCES, REGION_CITY_MAP, PROVINCE_CITIES } from '@/lib/service-areas/south-africa'
import { locationSearchTerms } from '@/lib/location-aliases'
import { expectedLocationSeedCounts, locationSlugPart, seedLocationNodes, validateLocationSeedDataset } from '@/lib/location-seed'

function createMemoryPrisma(existing: Record<string, any> = {}) {
  const rows = new Map<string, any>(Object.entries(existing))
  const client: any = {
    locationNode: {
      count: async () => rows.size,
      findMany: async ({ select }: any = {}) => {
        const values = [...rows.values()]
        if (!select) return values
        return values.map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])))
      },
      findUnique: async ({ where, select }: any) => {
        const row = rows.get(where.slug)
        if (!row) return null
        if (!select) return row
        return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]))
      },
      upsert: async ({ where, create, update }: any) => {
        const current = rows.get(where.slug)
        const next = current ? { ...current, ...update } : { id: `node-${rows.size + 1}`, ...create }
        rows.set(where.slug, next)
        return next
      },
    },
    $transaction: async (callback: any) => callback(client),
    __rows: rows,
  }
  return client
}

describe('South African location seed dataset', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('contains all 9 provinces and validates required mappings', () => {
    expect(Object.keys(SA_PROVINCES)).toEqual(expect.arrayContaining([
      'gauteng',
      'western_cape',
      'kwazulu_natal',
      'eastern_cape',
      'free_state',
      'limpopo',
      'mpumalanga',
      'northern_cape',
      'north_west',
    ]))
    expect(expectedLocationSeedCounts().provinces).toBe(9)
    expect(() => validateLocationSeedDataset()).not.toThrow()
  })

  it('populates Johannesburg and JHB West / Roodepoort with required suburbs', () => {
    const gauteng = SA_PROVINCES.gauteng
    expect(PROVINCE_CITIES.gauteng).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'johannesburg', label: 'Johannesburg' }),
    ]))
    expect(REGION_CITY_MAP.jhb_west).toMatchObject({ cityKey: 'johannesburg' })
    expect(gauteng.regions.jhb_west.name).toBe('JHB West / Roodepoort')
    expect(Object.keys(gauteng.regions.jhb_west.suburbs)).toEqual(expect.arrayContaining([
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
    ]))
  })

  it('normalizes aliases and slug parts consistently', () => {
    expect(locationSearchTerms('GP')).toEqual(['GP', 'Gauteng'])
    expect(locationSearchTerms('JHB West')).toEqual(['JHB West', 'JHB West / Roodepoort', 'Roodepoort'])
    expect(locationSearchTerms('Jozi')).toEqual(['Jozi', 'Johannesburg'])
    expect(locationSlugPart("Allen's Nek")).toBe('allens_nek')
    expect(locationSlugPart('Strubens Valley')).toBe('strubens_valley')
  })

  it('is idempotent and does not duplicate records when run twice', async () => {
    const prisma = createMemoryPrisma()
    const first = await seedLocationNodes(prisma)
    const countAfterFirst = prisma.__rows.size
    const second = await seedLocationNodes(prisma)

    expect(first.inserted).toBeGreaterThan(0)
    expect(second.inserted).toBe(0)
    expect(second.updated).toBe(countAfterFirst)
    expect(prisma.__rows.size).toBe(countAfterFirst)
  })

  it('blocks production destructive reset flags', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_LOCATION_RESET', 'true')

    await expect(seedLocationNodes(createMemoryPrisma())).rejects.toThrow('ALLOW_LOCATION_RESET is not permitted in production')
  })
})
