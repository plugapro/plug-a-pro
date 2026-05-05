// Manually replay the post-match acceptance notifications for an already-ACCEPTED
// lead. Use when the original notifyPostMatchAcceptance call was suppressed by a
// stale flag (e.g. lead.isTestLead mismatch) and the parties never received the
// confirmation messages.
//
// Usage:
//   pnpm tsx --env-file=.env.local scripts/replay-post-match-acceptance.ts <leadId>

import { PrismaClient } from '@prisma/client'
import { notifyPostMatchAcceptance } from '../lib/post-match-communications'

const db = new PrismaClient()

async function main() {
  const leadId = process.argv[2]
  if (!leadId) {
    console.error('Usage: replay-post-match-acceptance.ts <leadId>')
    process.exit(1)
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      providerId: true,
      status: true,
      jobRequest: { select: { match: { select: { id: true } } } },
    },
  })

  if (!lead) {
    console.error(`Lead ${leadId} not found`)
    process.exit(1)
  }
  if (lead.status !== 'ACCEPTED') {
    console.error(`Lead ${leadId} is not ACCEPTED (status=${lead.status}). Refusing to replay.`)
    process.exit(1)
  }
  const matchId = lead.jobRequest.match?.id
  if (!matchId) {
    console.error(`Lead ${leadId} has no Match record. Cannot replay.`)
    process.exit(1)
  }

  console.log(`Replaying notifyPostMatchAcceptance for lead=${leadId} match=${matchId}`)

  const result = await notifyPostMatchAcceptance({
    leadId,
    providerId: lead.providerId,
    matchId,
    creditTransactionId: null,
  })

  console.log('Replay complete:', result)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
