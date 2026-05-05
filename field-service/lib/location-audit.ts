import type { PrismaClient } from '@prisma/client'

export type LocationAuditResult = {
  ok: boolean
  checkedAt: string
  counts: {
    provinces: number
    cities: number
    regions: number
    suburbs: number
    inactive: number
    roodepoortSuburbs: number
  }
  roodepoortRegion: { id: string; label: string; active: boolean } | null
  roodepoortSuburbLabels: string[]
  failures: string[]
}

const REQUIRED_ROODEPOORT_SUBURBS = [
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

export async function auditLocationReferenceData(prisma: PrismaClient): Promise<LocationAuditResult> {
  const [provinceCount, cityCount, regionCount, suburbCount, inactiveCount, roodepoortRegion, roodepoortSuburbs] = await Promise.all([
    prisma.locationNode.count({ where: { nodeType: 'PROVINCE', active: true } }),
    prisma.locationNode.count({ where: { nodeType: 'CITY', active: true } }),
    prisma.locationNode.count({ where: { nodeType: 'REGION', active: true } }),
    prisma.locationNode.count({ where: { nodeType: 'SUBURB', active: true } }),
    prisma.locationNode.count({ where: { active: false } }),
    prisma.locationNode.findUnique({ where: { slug: 'gauteng__johannesburg__jhb_west' }, select: { id: true, label: true, active: true } }),
    prisma.locationNode.findMany({
      where: { nodeType: 'SUBURB', active: true, regionKey: 'jhb_west' },
      orderBy: { label: 'asc' },
      select: { label: true },
    }),
  ])

  const labels = roodepoortSuburbs.map((suburb) => suburb.label)
  const failures: string[] = []
  if (provinceCount < 9) failures.push(`Expected at least 9 active provinces, found ${provinceCount}`)
  if (cityCount < 15) failures.push(`Expected at least 15 active city nodes, found ${cityCount}`)
  if (regionCount < 24) failures.push(`Expected at least 24 active region nodes, found ${regionCount}`)
  if (suburbCount < 250) failures.push(`Expected at least 250 active suburb nodes, found ${suburbCount}`)
  if (!roodepoortRegion?.active) failures.push('JHB West / Roodepoort region is missing or inactive')
  for (const required of REQUIRED_ROODEPOORT_SUBURBS) {
    if (!labels.includes(required)) failures.push(`Required Roodepoort suburb missing: ${required}`)
  }

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    counts: {
      provinces: provinceCount,
      cities: cityCount,
      regions: regionCount,
      suburbs: suburbCount,
      inactive: inactiveCount,
      roodepoortSuburbs: labels.length,
    },
    roodepoortRegion,
    roodepoortSuburbLabels: labels,
    failures,
  }
}
