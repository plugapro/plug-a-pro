/**
 * Admin trigger: send completion check to a specific match or run the full batch.
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/send-completion-check.ts
 *   pnpm tsx --env-file=.env.local scripts/send-completion-check.ts --match=<matchId>
 *   pnpm tsx --env-file=.env.local scripts/send-completion-check.ts --match=<matchId> --yes
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { sendPendingCompletionChecks, retryPendingCompletionChecks, handleCompletionCheckYes } from '../lib/completion-check'
import { sendCompletionCheckMessage } from '../lib/whatsapp'
const db = new PrismaClient()
async function main() {
  const args = process.argv.slice(2)
  const targetMatchId = args.find((a) => a.startsWith('--match='))?.slice('--match='.length)
  const forceYes = args.includes('--yes')
  if (targetMatchId) {
    const m = await db.match.findUniqueOrThrow({ where: { id: targetMatchId }, select: { id: true, completionCheckSentAt: true, completionCheckStatus: true, jobRequest: { select: { category: true, customer: { select: { id: true, name: true, phone: true } } } }, provider: { select: { id: true, name: true, phone: true } } } })
    console.log(`match=${m.id} customer=${m.jobRequest.customer.name} provider=${m.provider.name} status=${m.completionCheckStatus ?? 'none'}`)
    if (forceYes) {
      await handleCompletionCheckYes({ matchId: targetMatchId, customerPhone: m.jobRequest.customer.phone })
      console.log('✓ Yes flow complete')
    } else {
      await sendCompletionCheckMessage({ customerPhone: m.jobRequest.customer.phone, customerName: m.jobRequest.customer.name, providerName: m.provider.name, serviceName: m.jobRequest.category, matchId: targetMatchId })
      await db.match.update({ where: { id: targetMatchId }, data: { completionCheckSentAt: new Date(), completionCheckStatus: 'SENT' } })
      console.log('✓ Completion check sent')
    }
  } else {
    const [n, r] = await Promise.all([sendPendingCompletionChecks(), retryPendingCompletionChecks()])
    console.log('new:', n, 'retries:', r)
  }
  await db.$disconnect()
}
main().catch((err) => { console.error(err); process.exit(1) })
