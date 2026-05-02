import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const jr = await db.jobRequest.findUnique({
    where: { id: 'cmon6pdfu0010jp05dtl7km6s' },
    include: {
      address: true,
      customer: { select: { name: true, phone: true } },
      dispatchDecisions: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          explanation: true,
          consideredCount: true,
          eligibleCount: true,
          filterSummary: true,
          createdAt: true,
        },
      },
    },
  })

  if (!jr) { console.log('Job request not found'); return }

  console.log('\n=== JOB REQUEST ===')
  console.log(JSON.stringify({
    id: jr.id,
    status: jr.status,
    category: jr.category,
    title: jr.title,
    addressId: jr.addressId,
    address: jr.address,
    assignmentMode: jr.assignmentMode,
    expiresAt: jr.expiresAt,
    isTestRequest: (jr as any).isTestRequest,
    createdAt: jr.createdAt,
    altSlotNegotiationSentAt: (jr as any).altSlotNegotiationSentAt,
    altSlotNegotiationOutcome: (jr as any).altSlotNegotiationOutcome,
  }, null, 2))

  console.log('\n=== DISPATCH DECISIONS (last 5) ===')
  if (jr.dispatchDecisions.length === 0) {
    console.log('  None — cron has never successfully reached this job request OR recorded a decision')
  } else {
    for (const d of jr.dispatchDecisions) {
      console.log(JSON.stringify(d, null, 2))
    }
  }

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
