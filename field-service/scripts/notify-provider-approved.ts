/**
 * Retry the approval WhatsApp notification for an already-approved provider application.
 * Usage: pnpm exec tsx scripts/notify-provider-approved.ts <applicationId>
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { notifyProviderApplicationApprovedOnce } from '../lib/provider-application-notifications'

const APPLICATION_ID = process.argv[2]
if (!APPLICATION_ID) {
  console.error('Usage: pnpm exec tsx scripts/notify-provider-approved.ts <applicationId>')
  process.exit(1)
}

async function main() {
  const app = await db.providerApplication.findUnique({
    where: { id: APPLICATION_ID },
    select: { id: true, phone: true, name: true, status: true, approvalWhatsappSentAt: true, approvalWhatsappSendStartedAt: true },
  })

  if (!app) {
    console.error('Application not found:', APPLICATION_ID)
    process.exit(1)
  }

  console.log(`Application: ${app.name} (${app.phone}) — status: ${app.status}`)
  console.log(`WhatsApp sent at: ${app.approvalWhatsappSentAt ?? 'not yet sent'}`)
  console.log(`WhatsApp send started at: ${app.approvalWhatsappSendStartedAt ?? 'not locked'}`)

  if (app.approvalWhatsappSentAt) {
    console.log('Notification already sent — nothing to do.')
    return
  }

  if (app.status !== 'APPROVED') {
    console.error(`Application status is ${app.status}, expected APPROVED. Aborting.`)
    process.exit(1)
  }

  const result = await notifyProviderApplicationApprovedOnce({
    applicationId: app.id,
    phone: app.phone,
    name: app.name,
  })

  if (result.status === 'sent') {
    console.log(`✓ WhatsApp approval notification sent (externalId=${result.externalId})`)
  } else {
    console.warn(`⚠ WhatsApp notification skipped: ${result.reason}`)
  }

  console.log('\nDone.')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
