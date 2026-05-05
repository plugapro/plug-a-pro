// ─── Admin: Provider application review ───────────────────────────────────────
// Lists all ProviderApplications submitted via WhatsApp.
// Approve: creates Provider + Supabase user invite + WhatsApp notification.
// Reject: sends rejection WhatsApp + updates status.

export const dynamic = 'force-dynamic'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdmin, createServiceClient } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { crudAction } from '@/lib/crud-action'
import { syncProviderRecord } from '@/lib/provider-record'
import { awardMobileVerifiedPromoCreditsInTransaction } from '@/lib/provider-promo-awards'
import {
  findConflictingActiveProviderApplications,
  getConflictingActiveProviderApplicationIds,
} from '@/lib/provider-applications'
import { buildMetadata } from '@/lib/metadata'
import { resolveServiceCategoryTag } from '@/lib/service-categories'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  status: true,
  notes: true,
  reviewedAt: true,
  reviewedById: true,
  isTestUser: true,
  cohortName: true,
  submittedAt: true,
  idNumber: true,
  _count: { select: { attachments: true } },
} as const

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
      }

      // Phase 4 follow-up Task 5 — atomicity invariant:
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
        where: { id, status: 'PENDING' },
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
        await (tx as any).providerCategory?.createMany?.({
          data: providerCategoryRows,
          skipDuplicates: true,
        })
        await (tx as any).providerCategory?.updateMany?.({
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

  // WhatsApp notification
  if (approval.data?.approvedNow) {
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

  if (approval.data?.providerId) {
    const { checkJobsForNewProviderAvailability } = await import('@/lib/matching/customer-recontact')
    await checkJobsForNewProviderAvailability(approval.data.providerId).catch((error) => {
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

  const pending  = applications.filter((a) => a.status === 'PENDING')
  const reviewed = applications.filter((a) => a.status !== 'PENDING')

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
                    {app.skills.join(', ') || '—'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Area: </span>
                    {app.serviceAreas.join(', ') || '—'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Experience: </span>
                    {app.experience || '—'}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Availability: </span>
                    {app.availability || '—'}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Submitted {app.submittedAt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}Ref: {app.id.slice(-8).toUpperCase()}
                  {' · '}ID: {app.idNumber ? '✓ provided' : app._count.attachments > 0 ? `${app._count.attachments} file(s)` : 'not provided'}
                </p>

                {hasConflict && (
                  <div className="tone-warning rounded-xl border px-3 py-2 text-sm">
                    Duplicate active application detected for this phone number. Reject or resolve the duplicate before approving so one provider does not end up with multiple active application records.
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {!claimedByCurrentUser ? (
                    <form action={claimApplication}>
                      <input type="hidden" name="id" value={app.id} />
                      <Button type="submit" size="sm" variant="outline" disabled={!crudEnabled}>
                        {assignment?.claimedById ? 'Take over' : 'Claim'}
                      </Button>
                    </form>
                  ) : (
                    <form action={releaseApplication}>
                      <input type="hidden" name="id" value={app.id} />
                      <Button type="submit" size="sm" variant="outline" disabled={!crudEnabled}>
                        Release
                      </Button>
                    </form>
                  )}

                  <form action={approveApplication}>
                    <input type="hidden" name="id" value={app.id} />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!crudEnabled || hasConflict}
                      className="bg-[var(--tone-success-fg)] text-white hover:opacity-90 disabled:bg-muted disabled:text-muted-foreground"
                    >
                      Approve
                    </Button>
                  </form>

                  <form action={rejectApplication} className="flex gap-2">
                    <input type="hidden" name="id" value={app.id} />
                    <Input
                      type="text"
                      name="reason"
                      placeholder="Reason (optional)"
                      className="h-8 w-48 text-sm"
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={!crudEnabled}>
                      Reject
                    </Button>
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
                    <Button type="submit" size="sm" variant="outline" disabled={!crudEnabled}>
                      More info
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>

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
                  <TableCell className="text-muted-foreground">{app.skills.join(', ') || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(app.status)} className="rounded-full">
                        {app.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.reviewedAt?.toLocaleDateString('en-ZA') ?? '—'}
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
