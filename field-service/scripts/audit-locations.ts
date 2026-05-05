import { PrismaClient } from '@prisma/client'

async function main() {
  const prisma = new PrismaClient()
  try {
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
        select: { slug: true, label: true, postalCode: true },
      }),
    ])

    const summary = {
      provinces: provinceCount,
      cities: cityCount,
      regions: regionCount,
      suburbs: suburbCount,
      inactive: inactiveCount,
      roodepoortRegion,
      roodepoortSuburbs: roodepoortSuburbs.length,
      roodepoortSuburbLabels: roodepoortSuburbs.map((suburb) => suburb.label),
    }
    console.log(JSON.stringify(summary, null, 2))

    if (provinceCount < 9) throw new Error(`Location audit failed: expected 9 active provinces, found ${provinceCount}`)
    if (!roodepoortRegion?.active) throw new Error('Location audit failed: JHB West / Roodepoort region is missing or inactive')
    if (!roodepoortSuburbs.some((suburb) => suburb.label === 'Roodepoort')) throw new Error('Location audit failed: Roodepoort suburb missing')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[audit:locations] failed', error)
  process.exit(1)
})
