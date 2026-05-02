import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // Check all dispatch decisions for this job (not just 5)
  const decisions = await db.dispatchDecision.findMany({
    where: { jobRequestId: 'cmon6pdfu0010jp05dtl7km6s' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, explanation: true, consideredCount: true, eligibleCount: true, filterSummary: true, createdAt: true },
  })
  console.log(`\n=== ALL DISPATCH DECISIONS (${decisions.length} total) ===`)
  for (const d of decisions) {
    console.log(`${d.createdAt.toISOString()} | ${d.status} | considered=${d.consideredCount} | eligible=${d.eligibleCount} | ${d.explanation}`)
    if (Array.isArray(d.filterSummary) && d.filterSummary.length > 0) {
      for (const f of d.filterSummary as any[]) {
        console.log(`  filtered: ${f.providerName ?? f.providerId} → ${f.filteredReasonCodes?.join(', ')}`)
      }
    }
  }

  // Check active assignment holds
  const holds = await db.assignmentHold.findMany({
    where: { jobRequestId: 'cmon6pdfu0010jp05dtl7km6s', status: 'ACTIVE' },
    select: { id: true, status: true, expiresAt: true, providerId: true, createdAt: true },
  })
  console.log(`\n=== ACTIVE ASSIGNMENT HOLDS (${holds.length}) ===`)
  for (const h of holds) {
    console.log(JSON.stringify(h, null, 2))
  }

  // Check both providers' isTestUser flag and availableNow
  const lovemore = await db.provider.findFirst({
    where: { phone: '+27823035070' },
    select: { id: true, name: true, availableNow: true, active: true, verified: true, status: true, isTestUser: true },
  })
  const seth = await db.provider.findFirst({
    where: { phone: '+27764010810' },
    select: { id: true, name: true, availableNow: true, active: true, verified: true, status: true, isTestUser: true },
  })
  console.log('\n=== PROVIDER FLAGS ===')
  console.log('Lovemore:', JSON.stringify(lovemore, null, 2))
  console.log('SETH:', JSON.stringify(seth, null, 2))

  // Check SETH's schedule / availability
  if (seth) {
    const availability = await db.technicianAvailability.findUnique({
      where: { providerId: seth.id },
    })
    const scheduleItems = await (db as any).scheduleItem.findMany({
      where: { technicianId: seth.id, startAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { startAt: 'asc' },
      take: 10,
    })
    console.log('\n=== SETH AVAILABILITY ===')
    console.log(JSON.stringify(availability, null, 2))
    console.log('\n=== SETH SCHEDULE ITEMS (last 24h+) ===')
    console.log(JSON.stringify(scheduleItems, null, 2))
  }

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
