/**
 * Manual provider approval script — runs the full cron approval process
 * for a specific application ID.
 * Usage: pnpm exec tsx scripts/manual-approve-provider.ts <applicationId>
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { syncProviderRecord } from '../lib/provider-record'
import { syncProviderSkills } from '../lib/provider-skills'
import { awardMobileVerifiedPromoCreditsInTransaction } from '../lib/provider-promo-awards'
import { notifyProviderApplicationApprovedOnce } from '../lib/provider-application-notifications'

const APPLICATION_ID = process.argv[2]
if (!APPLICATION_ID) {
  console.error('Usage: pnpm exec tsx scripts/manual-approve-provider.ts <applicationId>')
  process.exit(1)
}

async function main() {
  const app = await db.providerApplication.findUnique({
    where: { id: APPLICATION_ID },
    select: { id: true, phone: true, name: true, skills: true, serviceAreas: true, status: true, isTestUser: true, cohortName: true },
  })

  if (!app) {
    console.error('Application not found:', APPLICATION_ID)
    process.exit(1)
  }

  console.log(`Processing application for ${app.name} (${app.phone}) — current status: ${app.status}`)

  if (app.status !== 'PENDING') {
    console.error(`Application status is ${app.status}, expected PENDING. Aborting.`)
    process.exit(1)
  }

  let providerId: string | null = null
  let approved = false

  await db.$transaction(async (tx) => {
    providerId = await syncProviderRecord(tx as typeof db, {
      phone: app.phone,
      name: app.name,
      skills: app.skills,
      serviceAreas: app.serviceAreas,
      active: true,
      availableNow: true,
      verified: true,
      isTestUser: app.isTestUser,
      cohortName: app.cohortName,
      skipEnrichment: true,
    })

    const update = await tx.providerApplication.updateMany({
      where: { id: app.id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedAt: new Date(), providerId },
    })
    approved = update.count > 0

    if (approved && providerId) {
      await awardMobileVerifiedPromoCreditsInTransaction(tx, providerId, {
        referenceType: 'provider_application',
        referenceId: app.id,
        createdBy: 'system:manual-approve',
      })
      console.log(`✓ Promo credits awarded (MOBILE_VERIFIED) to provider ${providerId}`)
    }
  }, { maxWait: 10_000, timeout: 20_000 })

  if (!approved) {
    console.error('Approval transaction did not update the application — may have already been approved by a concurrent run.')
    process.exit(1)
  }

  console.log(`✓ Application approved, provider record activated (id=${providerId})`)

  // Post-commit enrichment
  if (providerId) {
    await syncProviderSkills(db, providerId, app.skills).catch((err: unknown) => {
      console.warn('Post-commit skills sync failed (non-fatal):', err)
    })
    console.log(`✓ Provider skills synced`)
  }

  const notifyResult = await notifyProviderApplicationApprovedOnce({
    applicationId: app.id,
    phone: app.phone,
    name: app.name,
  })

  if (notifyResult.status === 'sent') {
    console.log(`✓ WhatsApp approval notification sent (externalId=${notifyResult.externalId})`)
  } else {
    console.warn(`⚠ WhatsApp notification skipped: ${notifyResult.reason}`)
  }

  console.log('\nDone.')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
