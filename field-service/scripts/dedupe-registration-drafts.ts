#!/usr/bin/env tsx
// One-time prod dedupe of duplicate un-submitted registration drafts.
// Dry-run by default; pass --execute to apply. Spec:
// .superpowers/sdd/task-5-brief.md (onboarding funnel hardening, Task 5)
//
// Prepares prod for a partial unique index (drafts.phone WHERE
// submittedApplicationId IS NULL) shipping separately — that index will
// reject inserts while duplicate un-submitted drafts still exist for a
// phone, so this script must run (with --execute) before the migration.
//
// Usage:
//   pnpm tsx scripts/dedupe-registration-drafts.ts             # dry-run
//   pnpm tsx scripts/dedupe-registration-drafts.ts --execute   # apply
import { db } from '../lib/db'
import { planDraftDedupe } from '../lib/provider-registration/draft-dedupe'

async function main() {
  const execute = process.argv.includes('--execute')

  const drafts = await db.providerApplicationDraft.findMany({
    where: { submittedApplicationId: null },
    select: {
      id: true,
      phone: true,
      updatedAt: true,
      lastCompletedStep: true,
      submittedApplicationId: true,
      identityVerifications: { select: { id: true, status: true } },
    },
  })

  const plan = planDraftDedupe(
    drafts.map((draft) => ({
      ...draft,
      verifications: draft.identityVerifications.map((v) => ({ id: v.id, status: String(v.status) })),
    })),
  )

  console.log(`phones with duplicates: ${plan.length}`)
  for (const entry of plan) {
    console.log(JSON.stringify(entry))
  }
  if (!execute) {
    console.log('DRY RUN — re-run with --execute after user authorization to apply.')
    return
  }

  for (const entry of plan) {
    await db.$transaction(async (tx) => {
      if (entry.expireVerificationIds.length > 0) {
        await tx.providerIdentityVerification.updateMany({
          where: { id: { in: entry.expireVerificationIds } },
          data: { status: 'EXPIRED', countsTowardAttemptCap: false },
        })
      }
      // Detach ALL verifications on losers (terminal ones included) so the FK
      // allows draft deletion while verification rows survive for audit.
      // Verification rows are NEVER deleted by this script.
      await tx.providerIdentityVerification.updateMany({
        where: { providerApplicationDraftId: { in: entry.loserIds } },
        data: { providerApplicationDraftId: null },
      })
      await tx.registrationResumeToken.deleteMany({ where: { draftId: { in: entry.loserIds } } })
      await tx.providerApplicationDraft.deleteMany({ where: { id: { in: entry.loserIds } } })
    })
    console.log(`deduped phone=${entry.phone} winner=${entry.winnerId} removed=${entry.loserIds.length}`)
  }
}

main()
  .then(async () => {
    await db.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await db.$disconnect()
    process.exit(1)
  })
