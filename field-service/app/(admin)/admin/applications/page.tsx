// ─── Admin: Provider application review ───────────────────────────────────────
// Lists all ProviderApplications submitted via WhatsApp.
// Approve: creates Provider + Supabase auth link + WhatsApp notification.
// Reject: sends rejection WhatsApp + updates status.

export const dynamic = 'force-dynamic'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { db } from '@/lib/db'
import { requireAdmin, createServiceClient } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { sendTemplate } from '@/lib/whatsapp'
import { crudAction } from '@/lib/crud-action'
import { syncProviderRecord } from '@/lib/provider-record'
import { createOrResolveProviderApprovalAuthUser } from '@/lib/provider-approval-auth-user'
import {
  findConflictingActiveProviderApplications,
  getConflictingActiveProviderApplicationIds,
  updateProviderApplicationCategoryApproval,
} from '@/lib/provider-applications'
import { buildMetadata } from '@/lib/metadata'
import { resolveServiceCategoryTag } from '@/lib/service-categories'
import { evaluateProviderProfileCompleteness } from '@/lib/provider-onboarding-completeness'
import {
  listProviderOnboardingRecoveryRows,
  WHATSAPP_RECOVERY_SESSION_WINDOW_MS,
  providerOnboardingStageLabel,
  sendProviderOnboardingRecoveryFollowUpForRef,
  sendProviderOnboardingRecoveryFollowUps,
} from '@/lib/provider-onboarding-recovery'
import { PROVIDER_PROFILE_PHOTO_LABEL } from '@/lib/provider-attachment-labels'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { Badge } from '@/components/ui/badge'
import { SubmitButton } from '@/components/admin/ui'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ApplicationStatus } from '@prisma/client'
import { getApplicationsAdminMessage } from '@/lib/admin-action-messages'
import { readRecoveryErrorMessage } from '@/lib/recovery-error-message'
import { ApplicationsV2View } from './applications-v2-view'

export const metadata = buildMetadata({ title: 'Applications', noIndex: true })

const FLAG = 'admin.crud.applications'
const APPLICATION_ROLES = ['OPS', 'ADMIN', 'OWNER'] as const
const RECOVERY_STAGE_KEYS = [
  'welcome_idle',
  'register_started_no_name',
  'id_verification_started',
  'skills_picker',
  'city_picker',
  'evidence_upload',
  'submitted',
  'approved',
  'pending',
  'flow_conflict',
] as const

const ApplicationActionSchema = z.object({
  id: z.string().min(1),
})

const RejectApplicationSchema = ApplicationActionSchema.extend({
  reason: z.string().min(5),
})

const CategoryApprovalSchema = z.object({
  id: z.string().min(1),
  categorySlug: z.string().min(1),
  approvalStatus: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']),
})

const MoreInfoApplicationSchema = ApplicationActionSchema.extend({
  reason: z.string().min(5),
})

const SendRecoveryRowSchema = z.object({
  safeUserRef: z.string().min(1),
})

const providerApplicationSelect = {
  id: true,
  providerId: true,
  phone: true,
  name: true,
  skills: true,
  serviceAreas: true,
  experience: true,
  availability: true,
  callOutFee: true,
  status: true,
  notes: true,
  reviewedAt: true,
  reviewedById: true,
  isTestUser: true,
  cohortName: true,
  submittedAt: true,
  idNumber: true,
  evidenceNote: true,
  evidenceFileUrls: true,
  attachments: {
    select: {
      id: true,
      url: true,
      label: true,
      mimeType: true,
      safeForPreview: true,
      uploadedBy: true,
      createdAt: true,
    },
  },
  provider: {
    select: {
      id: true,
      verified: true,
      kycStatus: true,
      avatarUrl: true,
      providerCategories: {
        select: {
          categorySlug: true,
          approvalStatus: true,
          updatedAt: true,
        },
      },
    },
  },
  _count: { select: { attachments: true } },
} as const

function resolveCategorySlug(skill: string) {
  return resolveServiceCategoryTag(skill) ?? skill.toLowerCase().trim().replace(/\s+/g, '_')
}

function evaluateApplicationCompleteness(application: {
  name: string
  phone: string
  skills: string[]
  serviceAreas: string[]
  experience: string | null
  availability: string | null
  callOutFee: { toString(): string } | number | string | null
  idNumber: string | null
  attachments: Array<{ label: string | null; id: string }>
  provider?: { avatarUrl: string | null } | null
}) {
  const profilePhotoAttachmentId =
    application.attachments.find((attachment) => attachment.label === PROVIDER_PROFILE_PHOTO_LABEL)?.id ?? null
  const callOutFee =
    application.callOutFee == null ? null : Number(application.callOutFee)

  return evaluateProviderProfileCompleteness({
    name: application.name,
    phone: application.phone,
    skills: application.skills,
    serviceAreas: application.serviceAreas,
    experience: application.experience,
    availability: application.availability,
    callOutFee,
    idNumber: application.idNumber,
    avatarUrl: application.provider?.avatarUrl ?? null,
    profilePhotoAttachmentId,
  })
}

// ─── Server Actions ───────────────────────────────────────────────────────────

async function approveApplication(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const session = await requireAdmin()

  const app = await db.providerApplication.findUnique({
    where: { id },
    select: providerApplicationSelect,
  })
  if (!app || !['PENDING', 'MORE_INFO_REQUIRED'].includes(app.status)) return

  const completeness = evaluateApplicationCompleteness(app)
  if (!completeness.canApprove) {
    console.warn('[applications] Approval blocked by onboarding completeness requirements', {
      applicationId: app.id,
      missingFields: completeness.missing.map((item) => item.field),
    })
    redirect('/admin/applications?message=incomplete_application_for_approval')
  }

  const conflictingApplications = await findConflictingActiveProviderApplications(db, app.phone, {
    excludeId: app.id,
  })
  if (conflictingApplications.length > 0) {
    console.warn('[applications] Approval blocked by duplicate active applications', {
      applicationId: app.id,
      phone: app.phone,
      conflictingApplicationIds: conflictingApplications.map((candidate) => candidate.id),
    })
    redirect('/admin/applications?message=duplicate_active_application')
  }

  let approvedNow = false
  let approvedProviderId: string | null = null
  try {
    const approval = await crudAction({
      entity: 'ProviderApplication',
      entityId: app.id,
      action: 'provider_application.approve',
      requiredRole: [...APPLICATION_ROLES],
      requiredFlag: FLAG,
      schema: ApplicationActionSchema,
      input: { id },
      before: {
        status: app.status,
        providerId: app.providerId,
        reviewedById: app.reviewedById,
      },
      run: async (_data, tx) => {
        const supabase = createServiceClient()
        let authUser: { userId: string; source: 'created' | 'existing' }
        try {
          authUser = await createOrResolveProviderApprovalAuthUser({
            db: tx as never,
            supabase,
            phone: app.phone,
            name: app.name,
            providerId: app.providerId,
          })
        } catch (authError) {
          console.error('[applications] Supabase user create/resolve failed:', authError)
          throw new Error('Supabase user creation failed')
        }

        if (authUser.source === 'existing') {
          console.info('[applications] Reusing existing Supabase auth user for provider approval', {
            applicationId: app.id,
            providerId: app.providerId,
          })
        }

      // Phase 4 follow-up Task 5 - atomicity invariant:
      //   - syncProviderRecord(verified: true) flips Provider.status -> 'ACTIVE'
      //     (lib/provider-record.ts:199 maps `verified: true` to status ACTIVE).
      //   - The `tx.providerApplication.updateMany({ status: 'APPROVED' })` call
      //     below runs in the same crudAction transaction.
      // Both writes either commit together or roll back together, so a stale
      // Provider.status = 'APPLICATION_PENDING' alongside an APPROVED
      // application is structurally impossible. Existing coverage:
      // __tests__/lib/provider-record.test.ts asserts the verified->ACTIVE
      // mapping on every code path.
      const providerId = await syncProviderRecord(tx as typeof db, {
        userId: authUser.userId,
        phone: app.phone,
        name: app.name,
        skills: app.skills,
        serviceAreas: app.serviceAreas,
        active: true,
        availableNow: true,
        verified: true,
        isTestUser: app.isTestUser,
        cohortName: app.cohortName,
      })

      const { error: metaError } = await supabase.auth.admin.updateUserById(authUser.userId, {
        user_metadata: {
          role: 'provider',
          name: app.name,
          providerId,
        },
      })
      if (metaError) {
        console.error('[applications] Failed to stamp providerId in user_metadata:', metaError)
      }

      const statusUpdate = await tx.providerApplication.updateMany({
        where: { id, status: { in: ['PENDING', 'MORE_INFO_REQUIRED'] } },
        data: {
          status: 'APPROVED',
          providerId,
          reviewedAt: new Date(),
          reviewedById: session.id,
        },
      })

      if (statusUpdate.count === 0) {
        console.info('[applications] Approval skipped because application is no longer pending', {
          applicationId: app.id,
        })
        return {
          id: app.id,
          status: app.status,
          providerId,
          reviewedById: app.reviewedById,
          approvedNow: false,
        }
      }

      const providerCategoryRows = app.skills.map((skill) => ({
        providerId,
        categorySlug: resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
        approvalStatus: 'PENDING_REVIEW',
      }))

      if (providerCategoryRows.length > 0) {
        await tx.providerCategory.createMany({
          data: providerCategoryRows,
          skipDuplicates: true,
        })
        // Removed the updateMany that forced APPROVED - autoApproveLowRiskCategories
        // promotes LOW-risk rows after this transaction completes.
      }

      await releaseOpsQueueItem(tx as typeof db, {
        queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
        entityId: app.id,
      })

      return {
        id: app.id,
        status: 'APPROVED',
        providerId,
        reviewedById: session.id,
        approvedNow: true,
      }
    },
  })
    approvedNow = approval.data?.approvedNow ?? false
    approvedProviderId = approval.data?.providerId ?? null
  } catch (error) {
    if (
      typeof error === 'object' && error !== null && 'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw error
    console.error('[admin/applications] approveApplication failed:', error)
    revalidatePath('/admin/applications')
    redirect('/admin/applications?message=application_approval_failed')
  }

  // Post-approval side effects outside the crudAction try/catch so a dynamic-import
  // failure or WhatsApp error cannot surface as a false "approval failed" to the admin.
  if (approvedNow) {
    const { notifyTechnicianApplicationResult } = await import('@/lib/whatsapp-bot')
    await notifyTechnicianApplicationResult({
      applicationId: app.id,
      phone: app.phone,
      name: app.name,
      approved: true,
    }).catch((error) => {
      console.error('[applications] approval WhatsApp notification failed', {
        applicationId: app.id,
        phone: app.phone,
        error,
      })
    })
  }

  if (approvedProviderId) {
    const { checkJobsForNewProviderAvailability } = await import('@/lib/matching/customer-recontact')
    await checkJobsForNewProviderAvailability(approvedProviderId).catch((error) => {
      console.error('[applications] new-provider availability check failed:', error)
    })
  }

  if (approvedProviderId) {
    const { autoApproveLowRiskCategories } = await import('@/lib/provider-categories')
    await autoApproveLowRiskCategories(approvedProviderId).catch((error) => {
      console.error('[applications] autoApproveLowRiskCategories failed', { providerId: approvedProviderId }, error)
    })
  }

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
  if (approvedNow) {
    redirect('/admin/applications?message=application_approved')
  }
}

async function requestMoreInfo(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const reason = String(formData.get('reason') ?? '').trim()
  const session = await requireAdmin()

  const app = await db.providerApplication.findUnique({
    where: { id },
    select: providerApplicationSelect,
  })
  if (!app || app.status !== 'PENDING') return

  try {
    await crudAction({
      entity: 'ProviderApplication',
      entityId: app.id,
      action: 'provider_application.request_more_info',
      requiredRole: [...APPLICATION_ROLES],
      requiredFlag: FLAG,
      schema: MoreInfoApplicationSchema,
      input: { id, reason },
      before: {
        status: app.status,
        providerId: app.providerId,
        reviewedById: app.reviewedById,
      },
      run: async (_data, tx) => {
        await tx.providerApplication.update({
          where: { id },
          data: {
            status: 'MORE_INFO_REQUIRED',
            reviewedAt: new Date(),
            reviewedById: session.id,
            notes: reason,
          },
        })

        await releaseOpsQueueItem(tx as typeof db, {
          queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
          entityId: app.id,
        })

        return {
          id: app.id,
          status: 'MORE_INFO_REQUIRED',
          reviewedById: session.id,
          notes: reason,
        }
      },
    })
  } catch (error) {
    if (
      typeof error === 'object' && error !== null && 'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw error
    console.error('[admin/applications] requestMoreInfo failed:', error)
    revalidatePath('/admin/applications')
    redirect('/admin/applications?message=application_more_info_failed')
  }

  const { sendText } = await import('@/lib/whatsapp-interactive')
  await sendText(
    app.phone,
    [
      'ℹ️ *More information needed*',
      '',
      `Hi ${app.name.split(' ')[0] || 'there'}, Plug A Pro needs more information before approving your provider application.`,
      '',
      `Reason: ${reason}`,
      '',
      'Please reply here with the requested information. Your application is not approved yet, so you cannot receive leads.',
    ].join('\n'),
    {
      templateName: 'interactive:provider_more_info_required',
      metadata: { applicationId: app.id, reviewedById: session.id },
    },
  ).catch((error) => {
    console.error('[applications] more-info WhatsApp notification failed', {
      applicationId: app.id,
      phone: app.phone,
      error,
    })
  })

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
  redirect('/admin/applications?message=application_more_info_sent')
}

async function updateCategoryApproval(formData: FormData) {
  'use server'
  const parseResult = CategoryApprovalSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    categorySlug: String(formData.get('categorySlug') ?? ''),
    approvalStatus: String(formData.get('approvalStatus') ?? ''),
  })
  if (!parseResult.success) return

  const admin = await requireAdmin()

  await crudAction({
    entity: 'ProviderCategory',
    entityId: `${parseResult.data.id}:${parseResult.data.categorySlug}`,
    action: 'provider_application.category_approval',
    requiredRole: [...APPLICATION_ROLES],
    requiredFlag: FLAG,
    schema: CategoryApprovalSchema,
    input: parseResult.data,
    run: async (_input, tx) => {
      await updateProviderApplicationCategoryApproval(tx, {
        applicationId: parseResult.data.id,
        categorySlug: parseResult.data.categorySlug,
        approvalStatus: parseResult.data.approvalStatus,
        actorId: admin.id,
      })

      return { ok: true }
    },
  })

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
}

async function rejectApplication(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const reason = String(formData.get('reason') ?? '').trim()
  const session = await requireAdmin()

  if (reason.length < 5) {
    redirect('/admin/applications?message=application_reject_reason_required')
  }

  const app = await db.providerApplication.findUnique({
    where: { id },
    select: providerApplicationSelect,
  })
  if (!app || app.status !== 'PENDING') return

  try {
    await crudAction({
      entity: 'ProviderApplication',
      entityId: app.id,
      action: 'provider_application.reject',
      requiredRole: [...APPLICATION_ROLES],
      requiredFlag: FLAG,
      schema: RejectApplicationSchema,
      input: { id, reason },
      before: {
        status: app.status,
        providerId: app.providerId,
        reviewedById: app.reviewedById,
      },
      run: async (_data, tx) => {
        await tx.providerApplication.update({
          where: { id },
          data: {
            status: 'REJECTED',
            provider: app.providerId
              ? {
                  update: {
                    active: false,
                    availableNow: false,
                    verified: false,
                  },
                }
              : undefined,
            reviewedAt: new Date(),
            reviewedById: session.id,
            notes: reason,
          },
        })

        await releaseOpsQueueItem(tx as typeof db, {
          queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
          entityId: app.id,
        })

        return {
          id: app.id,
          status: 'REJECTED',
          providerId: app.providerId,
          reviewedById: session.id,
          notes: reason,
        }
      },
    })
  } catch (error) {
    if (
      typeof error === 'object' && error !== null && 'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw error
    console.error('[admin/applications] rejectApplication failed:', error)
    revalidatePath('/admin/applications')
    redirect('/admin/applications?message=application_rejection_failed')
  }

  const { notifyTechnicianApplicationResult } = await import('@/lib/whatsapp-bot')
  await notifyTechnicianApplicationResult({
    phone: app.phone,
    name: app.name,
    approved: false,
    reason,
  }).catch(() => {})

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
  redirect('/admin/applications?message=application_rejected')
}

async function claimApplication(formData: FormData) {
  'use server'
  const admin = await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  await crudAction({
    entity: 'ProviderApplication',
    entityId: id,
    action: 'provider_application.claim',
    requiredRole: [...APPLICATION_ROLES],
    requiredFlag: FLAG,
    schema: ApplicationActionSchema,
    input: { id },
    run: async (_input, tx) => {
      await claimOpsQueueItem(tx, {
        queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
        entityId: id,
        claimedById: admin.id,
        claimedByRole: admin.adminRole,
        claimedByLabel: admin.email ?? 'admin',
      })

      return { id }
    },
  })

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
}

async function releaseApplication(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  if (!id) return

  await crudAction({
    entity: 'ProviderApplication',
    entityId: id,
    action: 'provider_application.release',
    requiredRole: [...APPLICATION_ROLES],
    requiredFlag: FLAG,
    schema: ApplicationActionSchema,
    input: { id },
    run: async (_input, tx) => {
      await releaseOpsQueueItem(tx, {
        queueType: OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
        entityId: id,
      })

      return { id }
    },
  })

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
}

// ─── Recovery follow-up actions ──────────────────────────────────────────────
// Send the suggested WhatsApp message to a single stalled provider row, or run
// the batch path the cron uses. External HTTP send is intentionally kept outside
// any DB transaction; an AdminAuditEvent is written separately for the operator
// action and recordProviderOnboardingRecoveryOutcome still writes an AuditLog
// row from inside sendProviderOnboardingRecoveryFollowUp[ForRef].

const RECOVERY_BANNER_BY_SKIP_REASON: Record<
  'not_found' | 'no_phone' | 'outside_session_window' | 'already_claimed' | 'no_recovery_for_stage',
  string
> = {
  not_found: 'recovery_skipped_not_found',
  no_phone: 'recovery_skipped_no_phone',
  outside_session_window: 'recovery_skipped_window',
  already_claimed: 'recovery_skipped_locked',
  no_recovery_for_stage: 'recovery_skipped_stage',
}

async function sendRecoveryNudgeForRow(formData: FormData) {
  'use server'
  const parsed = SendRecoveryRowSchema.safeParse({
    safeUserRef: String(formData.get('safeUserRef') ?? ''),
  })
  if (!parsed.success) return
  const { safeUserRef } = parsed.data

  const admin = await requireAdmin()
  if (!APPLICATION_ROLES.includes(admin.adminRole as (typeof APPLICATION_ROLES)[number])) {
    redirect('/admin/applications?message=recovery_blocked_role')
  }
  const flagOn = await isEnabled(FLAG, { userId: admin.id })
  if (!flagOn) {
    redirect('/admin/applications?message=recovery_blocked_flag')
  }
  const templateFlagEnabled = await isEnabled('whatsapp.recovery.template_send', { userId: admin.id })

  let bannerCode = 'recovery_failed'
  try {
    const result = await sendProviderOnboardingRecoveryFollowUpForRef(db, {
      safeUserRef,
      actorId: `operator:${admin.id}`,
      sendTemplate,
      templateFlagEnabled,
    })
    // Duck-typed so a real Error instance, a serialized error shape, or a
    // bare string all flow into the same TEMPLATE_NOT_APPROVED detection and
    // the AdminAuditEvent.after.error capture. `instanceof Error` was failing
    // in production on 2026-06-06 (Meta code 132001 surfaced as recovery_failed
    // instead of recovery_template_not_approved) — likely cross-module Error
    // identity under Turbopack — and the duck-type guard sidesteps the issue.
    const errorMessage = result.outcome === 'error'
      ? readRecoveryErrorMessage(result.error)
      : null

    if (result.outcome === 'sent' && result.via === 'template') {
      bannerCode = 'recovery_sent_template'
    } else if (result.outcome === 'sent') {
      bannerCode = 'recovery_sent'
    } else if (result.outcome === 'skipped') {
      bannerCode = RECOVERY_BANNER_BY_SKIP_REASON[result.reason]
    } else if (result.outcome === 'error' && errorMessage?.includes('[TEMPLATE_NOT_APPROVED]')) {
      bannerCode = 'recovery_template_not_approved'
    }

    const auditErrorMessage = errorMessage?.slice(0, 512) ?? null

    await db.adminAuditEvent.create({
      data: {
        adminId: admin.id,
        action: 'provider_onboarding_recovery.manual_send',
        entityType: 'ProviderOnboardingRecovery',
        entityId: safeUserRef,
        after: {
          outcome: result.outcome,
          ...(result.outcome === 'skipped' ? { reason: result.reason } : {}),
          ...(result.outcome === 'sent'
            ? {
              stage: result.row.stage,
              messageTemplateKey: result.row.messageTemplateKey,
              via: result.via,
            }
            : {}),
          ...(auditErrorMessage ? { error: auditErrorMessage } : {}),
        },
      },
    }).catch((error) => {
      console.error('[admin/applications] manual recovery audit write failed', { safeUserRef, error })
    })
  } catch (error) {
    if (
      typeof error === 'object' && error !== null && 'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw error
    console.error('[admin/applications] sendRecoveryNudgeForRow failed', { safeUserRef, error })
    bannerCode = 'recovery_failed_unavailable'
  }

  revalidatePath('/admin/applications')
  redirect(`/admin/applications?message=${bannerCode}`)
}

async function sendAllDueRecoveryNudges() {
  'use server'
  const admin = await requireAdmin()
  if (!APPLICATION_ROLES.includes(admin.adminRole as (typeof APPLICATION_ROLES)[number])) {
    redirect('/admin/applications?message=recovery_blocked_role')
  }
  const flagOn = await isEnabled(FLAG, { userId: admin.id })
  if (!flagOn) {
    redirect('/admin/applications?message=recovery_blocked_flag')
  }
  const templateFlagEnabled = await isEnabled('whatsapp.recovery.template_send', { userId: admin.id })

  try {
    const result = await sendProviderOnboardingRecoveryFollowUps(db, {
      actorId: `operator:${admin.id}`,
      sendTemplate,
      templateFlagEnabled,
    })
    await db.adminAuditEvent.create({
      data: {
        adminId: admin.id,
        action: 'provider_onboarding_recovery.batch_send',
        entityType: 'ProviderOnboardingRecovery',
        entityId: `batch:${admin.id}:${Date.now()}`,
        after: {
          total: result.total,
          due: result.due,
          sent: result.sent,
          skipped: result.skipped,
          errors: result.errors,
        },
      },
    }).catch((error) => {
      console.error('[admin/applications] batch recovery audit write failed', { error })
    })
  } catch (error) {
    if (
      typeof error === 'object' && error !== null && 'digest' in error &&
      typeof (error as { digest?: string }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) throw error
    console.error('[admin/applications] sendAllDueRecoveryNudges failed', { error })
    revalidatePath('/admin/applications')
    redirect('/admin/applications?message=recovery_failed_unavailable')
  }

  revalidatePath('/admin/applications')
  redirect('/admin/applications?message=recovery_batch_dispatched')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function getStatusVariant(status: ApplicationStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'APPROVED') return 'default'
  if (status === 'REJECTED') return 'destructive'
  if (status === 'MORE_INFO_REQUIRED') return 'outline'
  return 'secondary'
}

function getCategoryStatusVariant(status: string): 'success' | 'danger' | 'warning' | 'outline' {
  if (status === 'APPROVED') return 'success'
  if (status === 'REJECTED') return 'danger'
  if (status === 'PENDING_REVIEW') return 'warning'
  return 'outline'
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await requireAdmin()
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const templateFlagEnabled = await isEnabled('whatsapp.recovery.template_send', { userId: admin.id })
  const v2Enabled = await isEnabled('admin.applications.redesign_v2', { userId: admin.id })
  const resolvedSearchParams = await searchParams
  const message = typeof resolvedSearchParams.message === 'string' ? resolvedSearchParams.message : undefined
  const banner = getApplicationsAdminMessage(message)
  const now = new Date()

  const applications = await db.providerApplication.findMany({
    select: providerApplicationSelect,
    orderBy: { submittedAt: 'desc' },
    take: 100,
  })
  const onboardingRecoveryRows = await listProviderOnboardingRecoveryRows(db)
  const conflictingApplicationIds = getConflictingActiveProviderApplicationIds(applications)
  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
    applications.map((application) => application.id),
  )

  if (v2Enabled) {
    const bannerNode = banner ? (
      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          banner.tone === 'error'
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'tone-success'
        }`}
      >
        {banner.text}
      </div>
    ) : null

    return (
      <ApplicationsV2View
        applications={applications}
        recoveryRows={onboardingRecoveryRows}
        assignments={assignments}
        conflictingApplicationIds={conflictingApplicationIds}
        adminId={admin.id}
        crudEnabled={crudEnabled}
        templateFlagEnabled={templateFlagEnabled}
        bannerNode={bannerNode}
        flag={FLAG}
        searchParams={resolvedSearchParams}
        actions={{
          approve: approveApplication,
          reject: rejectApplication,
          requestMoreInfo,
          claim: claimApplication,
          release: releaseApplication,
          updateCategoryApproval,
          sendRecoveryNudge: sendRecoveryNudgeForRow,
          sendAllDueRecoveries: sendAllDueRecoveryNudges,
        }}
      />
    )
  }

  const pending = applications.filter((a) => a.status === 'PENDING')
  const approved = applications.filter((a) => a.status === 'APPROVED')
  const reviewed = applications.filter((a) => !['PENDING', 'APPROVED'].includes(a.status))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Provider Applications</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Applications submitted via WhatsApp. Approving an application allows that provider to receive marketplace leads.
        </p>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${banner.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'tone-success'}`}>
          {banner.text}
        </div>
      ) : null}

      {!crudEnabled && (
        <div className="tone-warning rounded-lg border px-4 py-2 text-sm">
          Application mutations are disabled. Enable the <code>{FLAG}</code> feature flag to claim, approve or reject provider applications.
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              WhatsApp onboarding recovery
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Recovery queue for recent inbound WhatsApp provider leads. Automatic nudges are audit-limited; phone numbers are masked.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <p className="text-xs text-muted-foreground">
              Stages: {RECOVERY_STAGE_KEYS.join(', ')}
            </p>
            <form action={sendAllDueRecoveryNudges}>
              <SubmitButton size="sm" variant="outline" disabled={!crudEnabled}>
                Send all due now
              </SubmitButton>
            </form>
          </div>
        </div>

        <Card>
          {onboardingRecoveryRows.length === 0 ? (
            <CardContent className="p-4 text-sm text-muted-foreground">
              No active provider onboarding recovery rows.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Captured</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Action / message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {onboardingRecoveryRows.map((row) => {
                  const outsideSessionWindow = now.getTime() - row.lastInteractionAt.getTime() > WHATSAPP_RECOVERY_SESSION_WINDOW_MS
                  const actionLabel = outsideSessionWindow && templateFlagEnabled ? 'Send template' : 'Send now'
                  return (
                    <TableRow key={`${row.source}:${row.id}`} data-admin-onboarding-recovery-row={row.stage}>
                      <TableCell>
                        <Badge variant={row.priority <= 2 ? 'warning' : 'outline'} className="rounded-full">
                          P{row.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="block">{row.phoneMasked}</span>
                        <span className="block text-xs text-muted-foreground">Tail {row.phoneTail}</span>
                        <span className="block text-xs text-muted-foreground">{row.safeUserRef}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.stage === 'flow_conflict' ? 'warning' : 'outline'} className="rounded-full">
                          {providerOnboardingStageLabel(row.stage)}
                        </Badge>
                        {outsideSessionWindow ? (
                          <Badge variant="destructive" className="mt-1 rounded-full">
                            Outside 23h window
                          </Badge>
                        ) : null}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.flow && row.step ? `${row.flow} / ${row.step}` : row.source}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.lastInteractionAt.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {row.followUpDueAt ? (
                          <span className="block text-xs">
                            Due {row.followUpDueAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="block">{row.providerName ?? '-'}</span>
                        <span className="block text-xs">{row.serviceCategory ?? 'Service not captured'}</span>
                        <span className="block text-xs">{row.area ?? 'Area not captured'}</span>
                        {row.applicationStatus ? (
                          <span className="block text-xs">Application: {row.applicationStatus}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="block">{row.followUpStatus}</span>
                        <span className="block text-xs">Last: {row.lastOutcomeStatus}</span>
                        {row.operatorNotes ? (
                          <span className="block text-xs">{row.operatorNotes}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-xl text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">{row.recommendedAction}</p>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 font-sans text-xs leading-relaxed text-muted-foreground">
                          {row.followUpMessage}
                        </pre>
                        {row.messageTemplateKey !== 'submitted_no_recovery' ? (
                          <form action={sendRecoveryNudgeForRow} className="mt-2">
                            <input type="hidden" name="safeUserRef" value={row.safeUserRef} />
                            <SubmitButton size="sm" variant="outline" disabled={!crudEnabled}>
                              {actionLabel}
                            </SubmitButton>
                          </form>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      {/* Pending */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Pending ({pending.length})
        </h2>

        {pending.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No pending applications.</p>
        )}

        {pending.map((app) => {
          const hasConflict = conflictingApplicationIds.has(app.id)
          const assignment = assignments.get(app.id)
          const claimedByCurrentUser = assignment?.claimedById === admin.id
          const completeness = evaluateApplicationCompleteness(app)
          const blockingItems = completeness.missing.filter((item) =>
            item.severity === 'block_submit' || item.severity === 'block_approve',
          )
          const approvalBlockedByCompleteness = !completeness.canApprove

          return (
            <Card key={app.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="font-medium">{app.name}</p>
                    <p className="text-sm text-muted-foreground">{app.phone}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                      {app.status}
                    </Badge>
                    <Badge variant={claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'}>
                      {formatOpsQueueOwnerLabel(assignment, admin.id)}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Skills: </span>
                    {app.skills.join(', ') || '-'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Area: </span>
                    {app.serviceAreas.join(', ') || '-'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Experience: </span>
                    {app.experience || '-'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Availability: </span>
                    {app.availability || '-'}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Submitted {app.submittedAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}Ref: {app.id.slice(-8).toUpperCase()}
                  {' · '}ID: {app.idNumber ? '✓ provided' : app._count.attachments > 0 ? `${app._count.attachments} file(s)` : 'not provided'}
                </p>

                <div className="space-y-2 rounded-lg border border-border p-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Application evidence</p>
                  {app.evidenceFileUrls.length > 0 ? (
                    <p>Evidence URLs: {app.evidenceFileUrls.join(', ')}</p>
                  ) : null}
                  {app.evidenceNote ? <p>Evidence note: {app.evidenceNote}</p> : null}
                  {app.idNumber ? <p>Identity number field present: supplied</p> : null}
                  {app.attachments.length > 0 ? (
                    <div className="space-y-1">
                      <p>Uploaded files ({app.attachments.length}):</p>
                      <ul className="ml-4 list-disc space-y-1">
                        {app.attachments.map((attachment) => (
                          <li key={attachment.id}>
                            <a
                              href={attachment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {attachment.label || attachment.id}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {hasConflict && (
                  <div className="tone-warning rounded-xl border px-3 py-2 text-sm">
                    Duplicate active application detected for this phone number. Reject or resolve the duplicate before approving so one provider does not end up with multiple active application records.
                  </div>
                )}
                {approvalBlockedByCompleteness && (
                  <div className="tone-warning rounded-xl border px-3 py-2 text-sm">
                    Approval blocked by missing required onboarding fields:
                    <ul className="ml-5 mt-1 list-disc">
                      {blockingItems.map((item) => (
                        <li key={`${app.id}-${item.field}`}>{item.field}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {!claimedByCurrentUser ? (
                    <form action={claimApplication}>
                      <input type="hidden" name="id" value={app.id} />
                      <SubmitButton size="sm" variant="outline" disabled={!crudEnabled}>
                        {assignment?.claimedById ? 'Take over' : 'Claim'}
                      </SubmitButton>
                    </form>
                  ) : (
                    <form action={releaseApplication}>
                      <input type="hidden" name="id" value={app.id} />
                      <SubmitButton size="sm" variant="outline" disabled={!crudEnabled}>
                        Release
                      </SubmitButton>
                    </form>
                  )}

                  <form action={approveApplication}>
                    <input type="hidden" name="id" value={app.id} />
                    <SubmitButton
                      size="sm"
                      disabled={!crudEnabled || hasConflict || approvalBlockedByCompleteness}
                      className="bg-[var(--tone-success-fg)] text-white hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
                    >
                      Approve
                    </SubmitButton>
                  </form>

                  <form action={rejectApplication} className="flex gap-2">
                    <input type="hidden" name="id" value={app.id} />
                    <Input
                      type="text"
                      name="reason"
                      placeholder="Reason (optional)"
                      className="h-8 w-48 text-sm"
                    />
                    <SubmitButton size="sm" variant="outline" disabled={!crudEnabled}>
                      Reject
                    </SubmitButton>
                  </form>

                  <form action={requestMoreInfo} className="flex gap-2">
                    <input type="hidden" name="id" value={app.id} />
                    <Input
                      type="text"
                      name="reason"
                      placeholder="Info needed"
                      className="h-8 w-48 text-sm"
                      required
                    />
                    <SubmitButton size="sm" variant="outline" disabled={!crudEnabled}>
                      More info
                    </SubmitButton>
                  </form>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

      {approved.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Approved ({approved.length})
          </h2>

          <div className="space-y-2">
            {approved.map((app) => {
              const requestedCategories = Array.from(new Set(app.skills.map(resolveCategorySlug)))
                .filter(Boolean)
                .filter((slug) => slug.length > 0)
              const providerCategoryStatusBySlug = new Map(
                (app.provider?.providerCategories ?? []).map((row) => [row.categorySlug, row.approvalStatus]),
              )
              const categoryStatuses = requestedCategories.map((categorySlug) =>
                providerCategoryStatusBySlug.get(categorySlug) ?? 'PENDING_REVIEW',
              )
              const approvedCategoryCount = categoryStatuses.filter((status) => status === 'APPROVED').length
              const rejectedCategoryCount = categoryStatuses.filter((status) => status === 'REJECTED').length
              const pendingCategoryCount = Math.max(
                requestedCategories.length - approvedCategoryCount - rejectedCategoryCount,
                0,
              )
              const categorySummary = requestedCategories.length === 0
                ? 'No categories captured'
                : [
                    `${requestedCategories.length} ${requestedCategories.length === 1 ? 'category' : 'categories'}`,
                    `${pendingCategoryCount} pending`,
                    `${approvedCategoryCount} approved`,
                    `${rejectedCategoryCount} rejected`,
                  ].join(' / ')
              const kycLabel = app.provider?.kycStatus?.replace(/_/g, ' ') ?? 'not started'

              return (
                <details
                  key={app.id}
                  data-admin-application-row="approved-provider"
                  className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                >
                  {/* Approved rows stay collapsed by default so ops can scan many providers before opening category controls. */}
                  <summary className="grid cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40 md:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.3fr)_minmax(220px,1fr)_auto_auto] [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{app.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{app.phone}</span>
                    </span>
                    <span className="min-w-0 text-xs text-muted-foreground">
                      <span className="block font-medium text-foreground">Provider profile</span>
                      <span className="block truncate">KYC: {kycLabel} / Verified: {app.provider?.verified ? 'Yes' : 'No'}</span>
                    </span>
                    <span className="min-w-0 text-xs text-muted-foreground">
                      <span className="block font-medium text-foreground">Categories</span>
                      <span className="block truncate">{categorySummary}</span>
                    </span>
                    <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                      {app.status}
                    </Badge>
                    <span className="inline-flex items-center justify-end gap-2 text-xs font-medium text-muted-foreground">
                      <span>View categories</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </span>
                  </summary>

                  <div
                    data-admin-application-details="approved-provider"
                    className="border-t border-border bg-muted/10 px-4 py-3"
                  >
                    <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
                      <div className="space-y-2 text-xs text-muted-foreground">
                        <p className="text-xs font-medium uppercase tracking-wide text-foreground">Profile context</p>
                        <p>Provider profile: {app.provider?.id ?? 'not created'}</p>
                        <p>KYC: {kycLabel}</p>
                        <p>Verified: {app.provider?.verified ? 'Yes' : 'No'}</p>
                        {app.provider?.id ? (
                          <Link href={`/admin/technicians/${app.provider.id}`} className="inline-flex text-foreground underline-offset-4 hover:underline">
                            Open provider profile
                          </Link>
                        ) : (
                          <p>Profile not linked yet</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Category-level approval
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {requestedCategories.length} requested
                          </span>
                        </div>
                        {requestedCategories.length === 0 ? (
                          <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                            No categories captured on this application.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {requestedCategories.map((categorySlug) => {
                              const currentStatus = providerCategoryStatusBySlug.get(categorySlug) ?? 'PENDING_REVIEW'
                              return (
                                <div
                                  key={categorySlug}
                                  className="grid gap-3 rounded-lg border border-border bg-background/80 p-3 lg:grid-cols-[1fr_auto] lg:items-center"
                                >
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="truncate text-sm font-medium">{categorySlug}</span>
                                    <Badge variant={getCategoryStatusVariant(currentStatus)} className="rounded-full">
                                      {currentStatus}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap gap-2 lg:justify-end">
                                    <form action={updateCategoryApproval}>
                                      <input type="hidden" name="id" value={app.id} />
                                      <input type="hidden" name="categorySlug" value={categorySlug} />
                                      <input type="hidden" name="approvalStatus" value="APPROVED" />
                                      <SubmitButton
                                        size="sm"
                                        variant="outline"
                                        disabled={!crudEnabled}
                                      >
                                        Approve
                                      </SubmitButton>
                                    </form>
                                    <form action={updateCategoryApproval}>
                                      <input type="hidden" name="id" value={app.id} />
                                      <input type="hidden" name="categorySlug" value={categorySlug} />
                                      <input type="hidden" name="approvalStatus" value="REJECTED" />
                                      <SubmitButton
                                        size="sm"
                                        variant="outline"
                                        disabled={!crudEnabled}
                                      >
                                        Reject
                                      </SubmitButton>
                                    </form>
                                    <form action={updateCategoryApproval}>
                                      <input type="hidden" name="id" value={app.id} />
                                      <input type="hidden" name="categorySlug" value={categorySlug} />
                                      <input type="hidden" name="approvalStatus" value="PENDING_REVIEW" />
                                      <SubmitButton
                                        size="sm"
                                        variant="outline"
                                        disabled={!crudEnabled}
                                      >
                                        Hold
                                      </SubmitButton>
                                    </form>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </details>
              )
            })}
          </div>
        </section>
      )}

      {/* Reviewed */}
      {reviewed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Reviewed ({reviewed.length})
          </h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Skills</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewed.map((app) => (
                  <TableRow key={app.id}>
                  <TableCell>{app.name}</TableCell>
                  <TableCell className="text-muted-foreground">{app.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{app.skills.join(', ') || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                        {app.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.reviewedAt?.toLocaleDateString('en-ZA') ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </div>
  )
}
