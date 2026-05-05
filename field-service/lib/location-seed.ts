import { LocationNodeType, type PrismaClient } from '@prisma/client'
import { LOCATION_ALIASES } from './location-aliases'
import { SA_PROVINCES, REGION_CITY_MAP, PROVINCE_CITIES } from './service-areas/south-africa'
import { SUBURB_POSTAL_CODES } from './service-areas/postal-codes'

export type LocationSeedSummary = {
  provinces: number
  cities: number
  regions: number
  suburbs: number
  aliases: number
  inserted: number
  updated: number
  skipped: number
  deactivated: number
  errors: string[]
}

export function locationSlugPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function expectedLocationSeedCounts(): Pick<LocationSeedSummary, 'provinces' | 'cities' | 'regions' | 'suburbs'> {
  let regions = 0
  let suburbs = 0
  for (const province of Object.values(SA_PROVINCES)) {
    regions += Object.keys(province.regions).length
    for (const region of Object.values(province.regions)) {
      suburbs += Object.keys(region.suburbs).length
    }
  }
  return {
    provinces: Object.keys(SA_PROVINCES).length,
    cities: Object.values(PROVINCE_CITIES).reduce((sum, cities) => sum + cities.length, 0),
    regions,
    suburbs,
  }
}

export function validateLocationSeedDataset(): void {
  const expected = expectedLocationSeedCounts()
  const errors: string[] = []
  if (expected.provinces !== 9) errors.push(`Expected 9 provinces, found ${expected.provinces}`)

  const missingRegions = Object.entries(SA_PROVINCES).flatMap(([, province]) =>
    Object.keys(province.regions).filter((regionKey) => !REGION_CITY_MAP[regionKey]),
  )
  if (missingRegions.length > 0) errors.push(`REGION_CITY_MAP is missing: ${missingRegions.join(', ')}`)

  const missingCities = Object.entries(SA_PROVINCES).flatMap(([provinceKey, province]) =>
    Object.keys(province.regions).flatMap((regionKey) => {
      const cityKey = REGION_CITY_MAP[regionKey]?.cityKey
      return PROVINCE_CITIES[provinceKey]?.some((city) => city.key === cityKey) ? [] : [`${provinceKey}/${regionKey}/${cityKey}`]
    }),
  )
  if (missingCities.length > 0) errors.push(`PROVINCE_CITIES is missing city mappings: ${missingCities.join(', ')}`)

  const requiredSlugs = [
    'gauteng__johannesburg__jhb_west',
    'gauteng__johannesburg__jhb_west__roodepoort',
    'gauteng__johannesburg__jhb_west__florida',
    'gauteng__johannesburg__jhb_west__discovery',
    'gauteng__johannesburg__jhb_west__little_falls',
    'gauteng__johannesburg__jhb_west__radiokop',
    'gauteng__johannesburg__jhb_west__ruimsig',
    'gauteng__johannesburg__jhb_west__strubens_valley',
    'gauteng__johannesburg__jhb_west__weltevreden_park',
    'gauteng__johannesburg__jhb_west__wilgeheuwel',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__bromhof',
  ]
  const generated = new Set<string>()
  for (const [provinceKey, province] of Object.entries(SA_PROVINCES)) {
    for (const [regionKey, region] of Object.entries(province.regions)) {
      const cityKey = REGION_CITY_MAP[regionKey]?.cityKey
      if (!cityKey) continue
      generated.add(`${provinceKey}__${cityKey}__${regionKey}`)
      for (const suburbLabel of Object.keys(region.suburbs)) {
        generated.add(`${provinceKey}__${cityKey}__${regionKey}__${locationSlugPart(suburbLabel)}`)
      }
    }
  }
  const missingRequired = requiredSlugs.filter((slug) => !generated.has(slug))
  if (missingRequired.length > 0) errors.push(`Required MVP location slugs missing: ${missingRequired.join(', ')}`)

  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export async function seedLocationNodes(prisma: PrismaClient): Promise<LocationSeedSummary> {
  validateLocationSeedDataset()

  const expected = expectedLocationSeedCounts()
  const existingCount = await prisma.locationNode.count()
  const expectedTotal = expected.provinces + expected.cities + expected.regions + expected.suburbs
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

  if (isProduction && process.env.ALLOW_LOCATION_RESET === 'true') {
    throw new Error('ALLOW_LOCATION_RESET is not permitted in production. Location master data must be upserted or soft-deactivated, not reset.')
  }
  if (existingCount > 0 && expectedTotal < Math.floor(existingCount * 0.75) && process.env.ALLOW_LOCATION_RESET !== 'true') {
    throw new Error(`Location import aborted: expected ${expectedTotal} nodes would be much lower than existing ${existingCount}. Set ALLOW_LOCATION_RESET=true outside production only after exporting a backup.`)
  }

  const summary: LocationSeedSummary = {
    ...expected,
    aliases: Object.keys(LOCATION_ALIASES).length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    deactivated: 0,
    errors: [],
  }

  const existingSlugs = new Set(
    (await prisma.locationNode.findMany({ select: { slug: true } })).map((node) => node.slug),
  )

  await prisma.$transaction(async (tx) => {
    const upsertNode = async (slug: string, create: Parameters<typeof prisma.locationNode.upsert>[0]['create'], update: Parameters<typeof prisma.locationNode.upsert>[0]['update']) => {
      const node = await tx.locationNode.upsert({ where: { slug }, create, update })
      if (existingSlugs.has(slug)) summary.updated++
      else {
        summary.inserted++
        existingSlugs.add(slug)
      }
      return node
    }

    const provinceNodes: Record<string, { id: string }> = {}
    for (const [provinceKey, province] of Object.entries(SA_PROVINCES)) {
      provinceNodes[provinceKey] = await upsertNode(provinceKey, {
        slug: provinceKey,
        nodeType: LocationNodeType.PROVINCE,
        label: province.name,
        parentId: null,
        provinceKey,
        cityKey: null,
        regionKey: null,
        lat: null,
        lng: null,
        radiusKm: null,
        active: true,
        updatedAt: new Date(),
      }, {
        label: province.name,
        parentId: null,
        provinceKey,
        cityKey: null,
        regionKey: null,
        lat: null,
        lng: null,
        radiusKm: null,
        active: true,
      }) as { id: string }
    }

    const cityNodes: Record<string, { id: string }> = {}
    for (const [provinceKey, cities] of Object.entries(PROVINCE_CITIES)) {
      const provinceNode = provinceNodes[provinceKey]
      if (!provinceNode) continue
      for (const city of cities) {
        const slug = `${provinceKey}__${city.key}`
        cityNodes[slug] = await upsertNode(slug, {
          slug,
          nodeType: LocationNodeType.CITY,
          label: city.label,
          parentId: provinceNode.id,
          provinceKey,
          cityKey: city.key,
          regionKey: null,
          lat: null,
          lng: null,
          radiusKm: null,
          active: true,
          updatedAt: new Date(),
        }, {
          label: city.label,
          parentId: provinceNode.id,
          provinceKey,
          cityKey: city.key,
          regionKey: null,
          lat: null,
          lng: null,
          radiusKm: null,
          active: true,
        }) as { id: string }
      }
    }

    for (const [provinceKey, province] of Object.entries(SA_PROVINCES)) {
      for (const [regionKey, region] of Object.entries(province.regions)) {
        const cityKey = REGION_CITY_MAP[regionKey].cityKey
        const cityNode = cityNodes[`${provinceKey}__${cityKey}`]
        if (!cityNode) {
          summary.skipped++
          continue
        }
        const regionSlug = `${provinceKey}__${cityKey}__${regionKey}`
        const regionNode = await upsertNode(regionSlug, {
          slug: regionSlug,
          nodeType: LocationNodeType.REGION,
          label: region.name,
          parentId: cityNode.id,
          provinceKey,
          cityKey,
          regionKey,
          lat: region.center.lat,
          lng: region.center.lng,
          radiusKm: region.radiusKm,
          active: true,
          updatedAt: new Date(),
        }, {
          label: region.name,
          parentId: cityNode.id,
          provinceKey,
          cityKey,
          regionKey,
          lat: region.center.lat,
          lng: region.center.lng,
          radiusKm: region.radiusKm,
          active: true,
        }) as { id: string }

        for (const [suburbLabel, coord] of Object.entries(region.suburbs)) {
          const suburbKey = locationSlugPart(suburbLabel)
          const suburbSlug = `${provinceKey}__${cityKey}__${regionKey}__${suburbKey}`
          const postalCode = SUBURB_POSTAL_CODES[suburbSlug] ?? null
          await upsertNode(suburbSlug, {
            slug: suburbSlug,
            nodeType: LocationNodeType.SUBURB,
            label: suburbLabel,
            parentId: regionNode.id,
            postalCode,
            provinceKey,
            cityKey,
            regionKey,
            lat: coord.lat,
            lng: coord.lng,
            radiusKm: null,
            active: true,
            updatedAt: new Date(),
          }, {
            label: suburbLabel,
            parentId: regionNode.id,
            postalCode,
            provinceKey,
            cityKey,
            regionKey,
            lat: coord.lat,
            lng: coord.lng,
            radiusKm: null,
            active: true,
          })
        }
      }
    }
  }, { maxWait: 20_000, timeout: 180_000 })

  console.log('[seed:locations] summary', summary)
  return summary
}
