import { PrismaClient } from '@prisma/client'
import { seedLocationNodes } from '../lib/location-seed'

async function main() {
  const prisma = new PrismaClient()
  try {
    const summary = await seedLocationNodes(prisma)
    console.log('Location seed complete')
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[seed:locations] failed', error)
  process.exit(1)
})
