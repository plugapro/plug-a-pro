import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const jr = await db.jobRequest.findUnique({
    where: { id: 'cmon6pdfu0010jp05dtl7km6s' },
    select: { id: true, status: true, category: true, expiresAt: true, isTestRequest: true },
  })

  const lastDecision = await db.dispatchDecision.findFirst({
    where: { jobRequestId: 'cmon6pdfu0010jp05dtl7km6s' },
    orderBy: { createdAt: 'desc' },
    select: { status: true, explanation: true, consideredCount: true, eligibleCount: true, filterSummary: true, createdAt: true },
  })

  const leads = await db.lead.findMany({
    where: { jobRequestId: 'cmon6pdfu0010jp05dtl7km6s' },
    select: { id: true, providerId: true, status: true, sentAt: true, expiresAt: true },
  })

  const seth = await db.technicianAvailability.findUnique({
    where: { providerId: '9578aaec-4a55-4b59-9e1e-a9862e946e49' },
    select: { emergencyAvailable: true, availabilityState: true, availabilityMode: true },
  })

  const lovemore = await db.provider.findFirst({
    where: { phone: '+27823035070' },
    select: { isTestUser: true, availableNow: true, active: true, verified: true, status: true },
  })

  const nowUtc = new Date()
  const sastHour = (nowUtc.getUTCHours() + 2) % 24

  console.log('\n=== JOB REQUEST ===')
  console.log(JSON.stringify(jr, null, 2))

  console.log('\n=== LAST DISPATCH DECISION ===')
  console.log(JSON.stringify(lastDecision, null, 2))

  console.log('\n=== LEADS ===')
  console.log(leads.length === 0 ? '  None dispatched yet' : JSON.stringify(leads, null, 2))

  console.log('\n=== SETH availability ===')
  console.log(JSON.stringify(seth, null, 2))

  console.log('\n=== LOVEMORE flags ===')
  console.log(JSON.stringify(lovemore, null, 2))

  console.log('\n=== TIME ===')
  console.log(`UTC: ${nowUtc.toISOString()}`)
  console.log(`SAST hour: ${sastHour}`)
  console.log(`Inside standard hours (07:00–18:59 SAST): ${sastHour >= 7 && sastHour < 19}`)

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
