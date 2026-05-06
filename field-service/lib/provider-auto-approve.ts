// Phase 1 auto-approval — approves PENDING provider applications that have all
// required fields (name, skills, service areas, and experience).
// HIGH_RISK_CATEGORY applications (Electrical, Roofing, Pest Control, and Air
// Conditioning) are routed to manual review and are not auto-approved until
// review tooling records an explicit certification decision. Plumbing is
// standard and must not block auto-approval.
// MISSING_* reason codes block approval until the provider supplies the missing
// information.
//
// Called exclusively from the dedicated /api/cron/provider-auto-approve endpoint
// (every 25 min during SAST day hours, every 55 min during off-hours).

import type { Prisma } from '@prisma/client'
import { db } from './db'
import { assessProviderApplicationForOpsReview } from './provider-application-review-support'
import { syncProviderRecord } from './provider-record'
import { awardMobileVerifiedPromoCreditsInTransaction } from './provider-promo-awards'
import { OPS_QUEUE_TYPES, releaseOpsQueueItem } from './ops-queue'
import { notifyProviderApplicationApprovedOnce } from './provider-application-notifications'
import { checkJobsForNewProviderAvailability } from './matching/customer-recontact'
import { findConflictingActiveProviderApplications } from './provider-applications'
import { resolveServiceCategoryTag } from './service-categories'
import { recordAuditLog } from './audit'
import { hasAutoApprovalBlockingServiceSelection } from './service-category-policy'

const ACTOR_ID = 'system:auto-approve'

export async function autoApproveProviderApplications(
  client: typeof db = db,
  params: { limit?: number } = {},
): Promise<{ approved: number; skipped: number; errors: number }> {
  const applications = await client.providerApplication.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      phone: true,
      name: true,
      skills: true,
      serviceAreas: true,
      experience: true,
      notes: true,
      providerId: true,
      isTestUser: true,
      cohortName: true,
    },
    orderBy: { submittedAt: 'asc' },
    take: params.limit ?? 50,
  })

  let approved = 0
  let skipped = 0
  let errors = 0

  for (const app of applications) {
    // Incomplete profiles and configured auto-approval-blocking categories require manual
    // review. Uploading proof is provider-supplied only; it does not become a
    // verified certification until an ops reviewer records that decision.
    const assessment = assessProviderApplicationForOpsReview(app)
    const hasMissingFields = assessment.reasonCodes.some((code) => code.startsWith('MISSING_'))
    const hasAutoApprovalBlocker = hasAutoApprovalBlockingServiceSelection(app.skills)
    if (hasMissingFields || hasAutoApprovalBlocker) {
      skipped++
      continue
    }

    // Two active applications for the same phone would create duplicate provider
    // rows. Block until ops resolves the conflict.
    const conflicts = await findConflictingActiveProviderApplications(client, app.phone, {
      excludeId: app.id,
    })
    if (conflicts.length > 0) {
      skipped++
      continue
    }

    try {
      const result = await client.$transaction(async (tx: Prisma.TransactionClient) => {
        // skipEnrichment prevents syncProviderSkills/upsertStructuredServiceAreas
        // from running inside the transaction. A caught DB error in those helpers
        // puts the PostgreSQL connection in ABORTED state even if swallowed in JS,
        // causing all subsequent tx queries to fail. Enrichment runs after the tx.
        const providerId = await syncProviderRecord(tx as typeof db, {
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

        const statusUpdate = await tx.providerApplication.updateMany({
          where: { id: app.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            providerId,
            reviewedAt: new Date(),
            reviewedById: ACTOR_ID,
          },
        })

        // Another process approved this application concurrently — skip silently.
        if (statusUpdate.count === 0) return null

        const categoryRows = app.skills.map((skill) => ({
          providerId,
          categorySlug:
            resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
          approvalStatus: 'APPROVED',
        }))

        if (categoryRows.length > 0) {
          await (tx as any).providerCategory?.createMany?.({
            data: categoryRows,
            skipDuplicates: true,
          })
          await (tx as any).providerCategory?.updateMany?.({
            where: {
              providerId,
              categorySlug: { in: categoryRows.map((r) => r.categorySlug) },
            },
            data: { approvalStatus: 'APPROVED' },
          })
        }

        try {
          await awardMobileVerifiedPromoCreditsInTransaction(tx, providerId, {
            referenceType: 'provider_application',
            referenceId: app.id,
            createdBy: ACTOR_ID,
          })
        } catch (err) {
          // Keep onboarding flowing even when legacy/legacy-schema wallets do not
          // yet support this award metadata. Credits can be reconciled out-of-band.
          console.error('[auto-approve] promo award step failed', {
            applicationId: app.id,
            providerId,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        await releaseOpsQueueItem(tx as typeof db, {
          queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
          entityId: app.id,
        })

        return { providerId }
      }, { timeout: 15000 })

      if (!result) {
        skipped++
        continue
      }

      // Post-transaction enrichment: sync skills and service areas outside the
      // transaction so any caught DB errors cannot abort the approval itself.
      syncProviderRecord(client, {
        phone: app.phone,
        name: app.name,
        skills: app.skills,
        serviceAreas: app.serviceAreas,
        active: true,
        availableNow: true,
        verified: true,
        isTestUser: app.isTestUser,
        cohortName: app.cohortName,
      }).catch((err: unknown) => {
        console.error('[auto-approve] post-tx enrichment failed', {
          applicationId: app.id,
          error: err,
        })
      })

      approved++

      // Fire-and-forget — cron step 1e in match-leads will retry if this fails.
      notifyProviderApplicationApprovedOnce({
        applicationId: app.id,
        phone: app.phone,
        name: app.name,
      }).catch((err: unknown) => {
        console.error('[auto-approve] WhatsApp notification failed', {
          applicationId: app.id,
          error: err,
        })
      })

      // Re-check open job requests against the newly active provider.
      checkJobsForNewProviderAvailability(result.providerId).catch((err: unknown) => {
        console.error('[auto-approve] job recheck failed', {
          providerId: result.providerId,
          error: err,
        })
      })

      recordAuditLog({
        actorId: ACTOR_ID,
        actorRole: 'system',
        action: 'provider_application.auto_approve',
        entityType: 'ProviderApplication',
        entityId: app.id,
        after: {
          providerId: result.providerId,
          recommendation: assessment.recommendation,
          reasonCodes: assessment.reasonCodes,
        } as Prisma.InputJsonValue,
      }).catch(() => undefined)
    } catch (err) {
      console.error('[auto-approve] approval failed', { applicationId: app.id, error: err })
      errors++
    }
  }

  return { approved, skipped, errors }
}
