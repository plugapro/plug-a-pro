import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const sethId = '9578aaec-4a55-4b59-9e1e-a9862e946e49'

  const avail = await db.technicianAvailability.findUnique({
    where: { providerId: sethId },
  })
  console.log('\n=== SETH TechnicianAvailability ===')
  console.log(JSON.stringify(avail, null, 2))

  // Check SETH's capacity counter (assignedJobCount)
  const capacity = await (db as any).provider.findUnique({
    where: { id: sethId },
    select: { assignedJobCount: true, maxConcurrentJobs: true, availableNow: true },
  })
  console.log('\n=== SETH capacity ===')
  console.log(JSON.stringify(capacity, null, 2))

  // Simulate the emergency check for right now
  const nowUtcHour = new Date().getUTCHours()
  const isOutside = nowUtcHour < 7 || nowUtcHour >= 17
  console.log(`\n=== EMERGENCY CHECK (right now) ===`)
  console.log(`Current UTC hour: ${nowUtcHour}`)
  console.log(`isOutsideStandardLeadHours: ${isOutside}`)
  console.log(`SETH emergencyAvailable: ${avail?.emergencyAvailable}`)
  console.log(`Would SETH be blocked for EMERGENCY_NOT_AVAILABLE: ${avail?.emergencyAvailable === false && isOutside}`)

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
