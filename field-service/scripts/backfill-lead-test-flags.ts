import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const mismatched = await db.lead.findMany({
    where: {
      OR: [
        { isTestLead: false, jobRequest: { isTestRequest: true } },
        { isTestLead: true, jobRequest: { isTestRequest: false } },
        { cohortName: null, jobRequest: { cohortName: { not: null } } },
      ],
    },
    select: {
      id: true,
      isTestLead: true,
      cohortName: true,
      jobRequestId: true,
      jobRequest: { select: { isTestRequest: true, cohortName: true } },
    },
  })

  console.log(`Found ${mismatched.length} lead(s) with mismatched test flags`)

  if (mismatched.length === 0) {
    await db.$disconnect()
    return
  }

  for (const lead of mismatched) {
    console.log(
      `lead=${lead.id} jr=${lead.jobRequestId} ` +
        `lead.isTestLead=${lead.isTestLead} -> ${lead.jobRequest.isTestRequest} ` +
        `lead.cohortName=${lead.cohortName} -> ${lead.jobRequest.cohortName}`,
    )
  }

  if (dryRun) {
    console.log('Dry run — no updates applied. Re-run without --dry-run to fix.')
    await db.$disconnect()
    return
  }

  let updated = 0
  for (const lead of mismatched) {
    await db.lead.update({
      where: { id: lead.id },
      data: {
        isTestLead: lead.jobRequest.isTestRequest,
        cohortName: lead.jobRequest.cohortName,
      },
    })
    updated++
  }

  console.log(`Updated ${updated} lead(s)`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
