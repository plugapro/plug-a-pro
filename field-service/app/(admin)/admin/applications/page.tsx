// ─── Admin: Provider application review ───────────────────────────────────────
// Lists all ProviderApplications submitted via WhatsApp.
// Approve: creates Provider + Supabase user invite + WhatsApp notification.
// Reject: sends rejection WhatsApp + updates status.

export const dynamic = 'force-dynamic'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireAdmin, createServiceClient } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { crudAction } from '@/lib/crud-action'
import { syncProviderRecord } from '@/lib/provider-record'
import { awardMobileVerifiedPromoCreditsInTransaction } from '@/lib/provider-promo-awards'
import {
  findConflictingActiveProviderApplications,
  getConflictingActiveProviderApplicationIds,
  updateProviderApplicationCategoryApproval,
} from '@/lib/provider-applications'
import { buildMetadata } from '@/lib/metadata'
import { resolveServiceCategoryTag } from '@/lib/service-categories'
import { evaluateProviderProfileCompleteness } from '@/lib/provider-onboarding-completeness'
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

export const metadata = buildMetadata({ title: 'Applications', noIndex: true })

const FLAG = 'admin.crud.applications'
const APPLICATION_ROLES = ['OPS', 'ADMIN', 'OWNER'] as const

const ApplicationActionSchema = z.object({
  id: z.string().min(1),
})

const RejectApplicationSchema = ApplicationActionSchema.extend({
  reason: z.string().optional(),
})

const CategoryApprovalSchema = z.object({
  id: z.string().min(1),
  categorySlug: z.string().min(1),
  approvalStatus: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']),
})

const MoreInfoApplicationSchema = ApplicationActionSchema.extend({
  reason: z.string().min(5),
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
  const id = formData.get('id') as string
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
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          phone: app.phone,
          user_metadata: {
            role: 'provider',
            name: app.name,
          },
          phone_confirm: true,
        })

        if (authError || !authData.user) {
          console.error('[applications] Supabase user create failed:', authError)
          throw new Error('Supabase user creation failed')
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
        userId: authData?.user?.id ?? null,
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

      if (authData?.user?.id) {
        const { error: metaError } = await supabase.auth.admin.updateUserById(authData.user.id, {
          user_metadata: {
            role: 'provider',
            name: app.name,
            providerId,
          },
        })
        if (metaError) {
          console.error('[applications] Failed to stamp providerId in user_metadata:', metaError)
        }
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
        approvalStatus: 'APPROVED',
      }))

      if (providerCategoryRows.length > 0) {
        await tx.providerCategory.createMany({
          data: providerCategoryRows,
          skipDuplicates: true,
        })
        await tx.providerCategory.updateMany({
          where: {
            providerId,
            categorySlug: { in: providerCategoryRows.map((row) => row.categorySlug) },
          },
          data: { approvalStatus: 'APPROVED' },
        })
      }

      await awardMobileVerifiedPromoCreditsInTransaction(tx, providerId, {
        referenceType: 'provider_application',
        referenceId: app.id,
        createdBy: session.id,
      })

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

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
}

async function requestMoreInfo(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const reason = String(formData.get('reason') ?? '').trim()
  const session = await requireAdmin()

  const app = await db.providerApplication.findUnique({
    where: { id },
    select: providerApplicationSelect,
  })
  if (!app || app.status !== 'PENDING') return

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
  const id = formData.get('id') as string
  const reason = (formData.get('reason') as string) || undefined
  const session = await requireAdmin()

  const app = await db.providerApplication.findUnique({
    where: { id },
    select: providerApplicationSelect,
  })
  if (!app || app.status !== 'PENDING') return

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
        notes: reason ?? null,
      }
    },
  })

  const { notifyTechnicianApplicationResult } = await import('@/lib/whatsapp-bot')
  await notifyTechnicianApplicationResult({
    phone: app.phone,
    name: app.name,
    approved: false,
    reason,
  }).catch(() => {})

  revalidatePath('/admin/applications')
  revalidatePath('/admin')
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

// ─── Page ─────────────────────────────────────────────────────────────────────

function getStatusVariant(status: ApplicationStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'APPROVED') return 'default'
  if (status === 'REJECTED') return 'destructive'
  if (status === 'MORE_INFO_REQUIRED') return 'outline'
  return 'secondary'
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>
}) {
  const admin = await requireAdmin()
  const crudEnabled = await isEnabled(FLAG, { userId: admin.id })
  const { message } = await searchParams
  const banner = getApplicationsAdminMessage(message)

  const applications = await db.providerApplication.findMany({
    select: providerApplicationSelect,
    orderBy: { submittedAt: 'desc' },
    take: 100,
  })
  const conflictingApplicationIds = getConflictingActiveProviderApplicationIds(applications)
  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.PROVIDER_ONBOARDING,
    applications.map((application) => application.id),
  )

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
          Application mutations are disabled. Enable the <code>{FLAG}</code> feature flag to claim, approve, or reject provider applications.
        </div>
      )}

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

          {approved.map((app) => {
            const requestedCategories = Array.from(new Set(app.skills.map(resolveCategorySlug)))
              .filter(Boolean)
              .filter((slug) => slug.length > 0)
            const providerCategoryStatusBySlug = new Map(
              (app.provider?.providerCategories ?? []).map((row) => [row.categorySlug, row.approvalStatus]),
            )

            return (
              <Card key={app.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="font-medium">{app.name}</p>
                      <p className="text-sm text-muted-foreground">{app.phone}</p>
                      <p className="text-xs text-muted-foreground">
                        Provider profile: {app.provider?.id ?? 'not created'} ·
                        {' '}
                        KYC: {app.provider?.kycStatus?.replace(/_/g, ' ') ?? 'not started'} ·
                        {' '}
                        Verified: {app.provider?.verified ? 'Yes' : 'No'}
                        {' '}
                        ·
                        {' '}
                        {app.provider?.id ? (
                          <Link href={`/admin/technicians/${app.provider.id}`}>Open provider profile</Link>
                        ) : (
                          <span>Profile not linked yet</span>
                        )}
                      </p>
                    </div>
                    <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                      {app.status}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Category-level approval</p>
                    {requestedCategories.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No categories captured on this application.</p>
                    ) : (
                      <div className="space-y-2">
                        {requestedCategories.map((categorySlug) => {
                          const currentStatus = providerCategoryStatusBySlug.get(categorySlug) ?? 'not-set'
                          return (
                            <div key={categorySlug} className="space-y-1 rounded-md border border-border p-2">
                              <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="font-medium">{categorySlug}</span>
                                <span className="text-xs text-muted-foreground">{currentStatus}</span>
                              </div>
                              <div className="flex flex-wrap gap-2">
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
                </CardContent>
              </Card>
            )
          })}
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
