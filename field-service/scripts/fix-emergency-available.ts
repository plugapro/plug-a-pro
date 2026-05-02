import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // Fix existing providers who got the wrong default on approval
  const result = await db.technicianAvailability.updateMany({
    where: {
      emergencyAvailable: false,
      lastUpdatedChannel: 'approval',
    },
    data: { emergencyAvailable: true },
  })
  console.log(`Fixed ${result.count} provider availability record(s) — emergencyAvailable set to true`)
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
