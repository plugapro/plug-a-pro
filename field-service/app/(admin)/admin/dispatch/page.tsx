export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { CrudActionError, crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import {
  getDispatchHistory,
  manualOverrideAssignment,
  rankCandidatesForJobRequest,
  runAssignmentForJobRequest,
} from '@/lib/matching/service'
import { getDispatchAdminMessage } from '@/lib/admin-action-messages'
import { buildMetadata } from '@/lib/metadata'
import { getQueueAgeTone } from '@/lib/ops-dashboard/alerts'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { StaleBanner } from '@/components/admin/dashboard/StaleBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { CaseActivityTimeline } from '@/components/admin/case/CaseActivityTimeline'
import { CaseNotesPanel } from '@/components/admin/case/CaseNotesPanel'
import { ResolveCaseForm } from '@/components/admin/case/ResolveCaseForm'
import { getReasonCodesForQueue } from '@/lib/reason-codes'
import { getCaseByEntity, claimCase, releaseCase, resolveCase, reopenCase, addNote, getCase, addEvent } from '@/lib/cases'

export const metadata = buildMetadata({ title: 'Dispatch', noIndex: true })
const FLAG = 'admin.crud.dispatch'
const DISPATCH_ROLES = ['OPS', 'ADMIN', 'OWNER'] as const
const JobRequestQueueSchema = z.object({
  jobRequestId: z.string().min(1),
})
const OverrideSchema = z.object({
  jobRequestId: z.string().min(1),
  providerId: z.string().min(1),
})

export default async function AdminDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; message?: string }>
}) {
  const admin = await requireAdmin()
  const { request, message } = await searchParams
  const banner = getDispatchAdminMessage(message)
  const now = new Date()
  const pageWarnings: string[] = []
  const crudEnabled = await isEnabled(FLAG, admin.id)

  const requests = await db.jobRequest.findMany({
    where: {
      status: { in: ['OPEN', 'MATCHING'] },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      address: { select: { id: true, street: true, suburb: true, city: true, province: true, lat: true, lng: true } },
      match: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 30,
  }).catch((error) => {
    console.error('[admin/dispatch] Failed to load job requests', error)
    pageWarnings.push('Service request data is temporarily unavailable.')
    return []
  })

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.DISPATCH,
    requests.map((jobRequest) => jobRequest.id),
  ).catch((error) => {
    console.error('[admin/dispatch] Failed to load queue assignments', error)
    pageWarnings.push('Assignment ownership data is temporarily unavailable.')
    return new Map() as Awaited<ReturnType<typeof listOpsQueueAssignments>>
  })

  const selectedRequest = request
    ? requests.find((jobRequest) => jobRequest.id === request) ??
      await db.jobRequest.findUnique({
        where: { id: request },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: { select: { id: true, street: true, suburb: true, city: true, province: true, lat: true, lng: true } },
          match: true,
        },
      })
    : requests[0] ?? null

  async function runAutoAssign(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    try {
      const result = await crudAction({
        entity: 'JobRequest',
        action: 'dispatch.auto_assign',
        requiredRole: [...DISPATCH_ROLES],
        requiredFlag: FLAG,
        schema: JobRequestQueueSchema,
        input: { jobRequestId: String(formData.get('jobRequestId') ?? '') },
        run: async ({ jobRequestId }) => {
          await runAssignmentForJobRequest({
            jobRequestId,
            actor: { actorId: activeAdmin.id, actorRole: 'admin' },
            mode: 'AUTO_ASSIGN',
          })
          return { id: jobRequestId, mode: 'AUTO_ASSIGN' }
        },
      })
      revalidatePath('/admin/dispatch')
      revalidatePath('/admin')
      redirect(`/admin/dispatch?request=${result.data.id}&message=dispatch_updated`)
    } catch (error) {
      const jobRequestId = String(formData.get('jobRequestId') ?? '')
      if (!(error instanceof CrudActionError)) {
        console.error('[admin/dispatch] Auto-assign failed', { jobRequestId, error })
      }
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_failed`)
    }
  }

  async function rerankForReview(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    try {
      const result = await crudAction({
        entity: 'JobRequest',
        action: 'dispatch.rerank',
        requiredRole: [...DISPATCH_ROLES],
        requiredFlag: FLAG,
        schema: JobRequestQueueSchema,
        input: { jobRequestId: String(formData.get('jobRequestId') ?? '') },
        run: async ({ jobRequestId }) => {
          await runAssignmentForJobRequest({
            jobRequestId,
            actor: { actorId: activeAdmin.id, actorRole: 'admin' },
            mode: 'OPS_REVIEW',
          })
          return { id: jobRequestId, mode: 'OPS_REVIEW' }
        },
      })
      revalidatePath('/admin/dispatch')
      revalidatePath('/admin')
      redirect(`/admin/dispatch?request=${result.data.id}&message=dispatch_updated`)
    } catch (error) {
      const jobRequestId = String(formData.get('jobRequestId') ?? '')
      if (!(error instanceof CrudActionError)) {
        console.error('[admin/dispatch] Rerank failed', { jobRequestId, error })
      }
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_failed`)
    }
  }

  async function overrideAssignment(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    const providerId = String(formData.get('providerId') ?? '')
    const reasonCode = String(formData.get('reasonCode') || 'FORCE_ASSIGNED_COVERAGE_EXTENSION')
    try {
      await manualOverrideAssignment({
        jobRequestId,
        providerId,
        actor: { actorId: activeAdmin.id, actorRole: 'admin' },
        overrideReason: reasonCode,
      })
      await recordAuditLog({
        actorId: activeAdmin.id,
        actorRole: activeAdmin.role,
        action: 'dispatch.override_assignment',
        entityType: AUDIT_ENTITY.JOB_REQUEST,
        entityId: jobRequestId,
        after: { providerId, reasonCode },
      })
      // Record OPS_ACTION on the dispatch case
      const dispCase = await getCaseByEntity('DISPATCH', 'JOB_REQUEST', jobRequestId).catch(() => null)
      if (dispCase) {
        await addEvent({
          caseId: dispCase.id,
          type: 'OPS_ACTION',
          payload: { action: 'force_assign', providerId, reasonCode },
          actorUserId: activeAdmin.id,
        }).catch(() => {})
      }
      revalidatePath('/admin/dispatch')
      revalidatePath('/admin')
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_updated`)
    } catch (error) {
      console.error('[admin/dispatch] Override failed', { jobRequestId, providerId, error })
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_failed`)
    }
  }

  async function redispatchAction(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return
    const { dispatchLeads } = await import('@/lib/matching-engine')
    await dispatchLeads(jobRequestId).catch(() => {})
    const dispCase = await getCaseByEntity('DISPATCH', 'JOB_REQUEST', jobRequestId).catch(() => null)
    if (dispCase) {
      await addEvent({
        caseId: dispCase.id,
        type: 'OPS_ACTION',
        payload: { action: 'redispatch_triggered', triggeredBy: activeAdmin.id },
        actorUserId: activeAdmin.id,
      }).catch(() => {})
    }
    revalidatePath('/admin/dispatch')
    redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_updated`)
  }

  async function escalateToSupplyAction(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    const reason = String(formData.get('reason') || 'No providers available — needs supply expansion')
    if (!jobRequestId) return
    const dispCase = await getCaseByEntity('DISPATCH', 'JOB_REQUEST', jobRequestId).catch(() => null)
    if (dispCase) {
      await addEvent({
        caseId: dispCase.id,
        type: 'ESCALATION',
        payload: { reason, escalatedTo: 'SUPPLY', escalatedBy: activeAdmin.id },
        actorUserId: activeAdmin.id,
      }).catch(() => {})
    }
    // Note: a full Supply escalation ticket would require a dedicated entity type.
    // For now, the ESCALATION event on the dispatch case is the operational record.
    revalidatePath('/admin/dispatch')
    redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_updated`)
  }

  async function claimDispatch(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    try {
      const result = await crudAction({
        entity: 'JobRequest',
        action: 'dispatch.claim',
        requiredRole: [...DISPATCH_ROLES],
        requiredFlag: FLAG,
        schema: JobRequestQueueSchema,
        input: { jobRequestId: String(formData.get('jobRequestId') ?? '') },
        run: async ({ jobRequestId }, tx) => {
          await claimOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.DISPATCH,
            entityId: jobRequestId,
            claimedById: activeAdmin.id,
            claimedByRole: activeAdmin.adminRole,
            claimedByLabel: activeAdmin.email ?? 'admin',
          })
          return { id: jobRequestId, claimedById: activeAdmin.id }
        },
      })

      revalidatePath('/admin/dispatch')
      revalidatePath('/admin')
      redirect(`/admin/dispatch?request=${result.data.id}`)
    } catch (error) {
      const jobRequestId = String(formData.get('jobRequestId') ?? '')
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_failed`)
    }
  }

  async function releaseDispatch(formData: FormData) {
    'use server'
    try {
      const result = await crudAction({
        entity: 'JobRequest',
        action: 'dispatch.release',
        requiredRole: [...DISPATCH_ROLES],
        requiredFlag: FLAG,
        schema: JobRequestQueueSchema,
        input: { jobRequestId: String(formData.get('jobRequestId') ?? '') },
        run: async ({ jobRequestId }, tx) => {
          await releaseOpsQueueItem(tx, {
            queueType: OPS_QUEUE_TYPES.DISPATCH,
            entityId: jobRequestId,
          })
          return { id: jobRequestId, released: true }
        },
      })

      revalidatePath('/admin/dispatch')
      revalidatePath('/admin')
      redirect(`/admin/dispatch?request=${result.data.id}`)
    } catch (error) {
      const jobRequestId = String(formData.get('jobRequestId') ?? '')
      if (!(error instanceof CrudActionError)) {
        throw error
      }
      redirect(`/admin/dispatch?request=${jobRequestId}&message=dispatch_failed`)
    }
  }

  const showCloseOut = await isEnabled('ops.v2.closeOut')
  const dispatchCase = selectedRequest
    ? await getCaseByEntity('DISPATCH', 'JOB_REQUEST', selectedRequest.id).catch(() => null)
    : null
  const dispatchCaseFull = dispatchCase
    ? await getCase(dispatchCase.id).catch(() => null)
    : null
  const dispatchReasonCodes = getReasonCodesForQueue('DISPATCH')

  async function closeCaseAction(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const caseId = String(formData.get('caseId') ?? '')
    const reasonCode = String(formData.get('reasonCode') ?? '')
    const note = String(formData.get('note') ?? '') || undefined
    if (!caseId || !reasonCode) return
    await resolveCase({ caseId, resolvedBy: activeAdmin.id, reasonCode, note })
    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
  }

  async function reopenCaseAction(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const caseId = String(formData.get('caseId') ?? '')
    if (!caseId) return
    await reopenCase(caseId, activeAdmin.id)
    revalidatePath('/admin/dispatch')
  }

  async function claimCaseAction(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const caseId = String(formData.get('caseId') ?? '')
    const release = formData.get('release') === '1'
    if (!caseId) return
    if (release) {
      await releaseCase(caseId, activeAdmin.id)
    } else {
      await claimCase({ caseId, userId: activeAdmin.id })
    }
    revalidatePath('/admin/dispatch')
  }

  async function addNoteAction(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const caseId = dispatchCaseFull?.id
    const body = String(formData.get('body') ?? '').trim()
    if (!caseId || !body) return
    await addNote({ caseId, authorUserId: activeAdmin.id, body })
    revalidatePath('/admin/dispatch')
  }

  const ranking = selectedRequest
    ? await rankCandidatesForJobRequest(selectedRequest.id).catch((error) => {
        console.error('[admin/dispatch] Failed to load ranked candidates', error)
        pageWarnings.push('Ranked candidates failed to load.')
        return null
      })
    : null
  const history = selectedRequest
    ? await getDispatchHistory(selectedRequest.id).catch((error) => {
        console.error('[admin/dispatch] Failed to load dispatch history', error)
        pageWarnings.push('Dispatch history failed to load.')
        return []
      })
    : []
  const requestAuditTrail = selectedRequest
    ? await db.auditLog.findMany({
        where: { entityId: selectedRequest.id, entityType: AUDIT_ENTITY.JOB_REQUEST },
        select: { id: true, action: true, actorRole: true, timestamp: true },
        orderBy: { timestamp: 'desc' },
        take: 10,
      }).catch((error) => {
        console.error('[admin/dispatch] Failed to load audit trail', error)
        pageWarnings.push('Recent dispatch activity failed to load.')
        return []
      })
    : []

  return (
    <div className="space-y-6">
      {pageWarnings.length > 0 ? <StaleBanner refreshHref={`/admin/dispatch${request ? `?request=${request}` : ''}`} /> : null}
      {!crudEnabled ? (
        <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning-foreground">
          Dispatch mutations are read-only while <code>{FLAG}</code> is disabled.
        </div>
      ) : null}
      <div>
        <h1 className="text-xl font-semibold">Dispatch Console</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rank technicians, inspect schedule fit, and override the selected assignee when needed.
        </p>
      </div>

      {banner ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${banner.tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
          {banner.text}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open service requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.length === 0 && (
              <p className="text-sm text-muted-foreground">No open or matching requests.</p>
            )}
            {requests.map((jobRequest) => {
              const assignment = assignments.get(jobRequest.id)

              return (
                <Link
                  key={jobRequest.id}
                  href={`/admin/dispatch?request=${jobRequest.id}`}
                  className={`block rounded-lg border p-3 transition-colors ${
                    selectedRequest?.id === jobRequest.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{jobRequest.title}</p>
                      <p className="text-xs text-muted-foreground">{jobRequest.customer.name}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={jobRequest.status} type="jobRequest" />
                      <Badge
                        variant={
                          assignment?.claimedById === admin.id
                            ? 'brand'
                            : assignment?.claimedById
                              ? 'warning'
                              : 'outline'
                        }
                      >
                        {formatOpsQueueOwnerLabel(assignment, admin.id)}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {jobRequest.address
                      ? `${jobRequest.address.suburb}, ${jobRequest.address.city}`
                      : 'Area unavailable'}
                  </p>
                  <div className="mt-2">
                    <Badge variant={slaToneVariant(getQueueAgeTone('dispatch', ageMinutes(jobRequest.createdAt, now)))}>
                      Age {formatDispatchAge(jobRequest.createdAt)}
                    </Badge>
                  </div>
                </Link>
              )
            })}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {selectedRequest ? (
            <>
              {(() => {
                const assignment = assignments.get(selectedRequest.id)
                const claimedByCurrentUser = assignment?.claimedById === admin.id

                return (
              <Card>
                <CardHeader className="space-y-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{selectedRequest.title}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {selectedRequest.category} · {selectedRequest.customer.name} ·{' '}
                        {selectedRequest.address
                          ? `${selectedRequest.address.suburb}, ${selectedRequest.address.city}`
                          : 'Area unavailable'}
                      </p>
                    </div>
                    <Badge
                      variant={
                        claimedByCurrentUser ? 'brand' : assignment?.claimedById ? 'warning' : 'outline'
                      }
                    >
                      {formatOpsQueueOwnerLabel(assignment, admin.id)}
                    </Badge>
                  </div>
                  <div className="pt-1">
                    <Badge variant={slaToneVariant(getQueueAgeTone('dispatch', ageMinutes(selectedRequest.createdAt, now)))}>
                      Age {formatDispatchAge(selectedRequest.createdAt)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  {!claimedByCurrentUser ? (
                    <form action={claimDispatch}>
                      <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                      <Button type="submit" variant="outline" disabled={!crudEnabled}>
                        {assignment?.claimedById ? 'Take over dispatch' : 'Claim dispatch'}
                      </Button>
                    </form>
                  ) : (
                    <form action={releaseDispatch}>
                      <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                      <Button type="submit" variant="outline" disabled={!crudEnabled}>
                        Release dispatch
                      </Button>
                    </form>
                  )}
                  <form action={runAutoAssign}>
                    <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                    <Button type="submit" disabled={!crudEnabled}>Auto-assign top candidate</Button>
                  </form>
                  <form action={rerankForReview}>
                    <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                    <Button type="submit" variant="outline" disabled={!crudEnabled}>
                      Refresh ranked shortlist
                    </Button>
                  </form>
                  <form action={redispatchAction}>
                    <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                    <Button type="submit" variant="outline">
                      Re-dispatch (retry leads)
                    </Button>
                  </form>
                  <form action={escalateToSupplyAction}>
                    <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                    <Button type="submit" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/5">
                      Escalate to Supply
                    </Button>
                  </form>
                </CardContent>
              </Card>
                )
              })()}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Ranked candidates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!ranking || ranking.candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No eligible technicians for this request yet.
                    </p>
                  ) : (
                    ranking.candidates.map((candidate, index) => (
                      <div key={candidate.providerId} className="rounded-lg border p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              #{index + 1} {candidate.providerName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {candidate.selectionReason}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{candidate.score.toFixed(3)}</p>
                            <p className="text-xs text-muted-foreground">match score</p>
                          </div>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3 text-sm">
                          <Metric label="Travel" value={`${candidate.travelMinutes} min`} />
                          <Metric
                            label="Schedule"
                            value={candidate.canMeetWindow ? 'Fits window' : 'Tight window'}
                          />
                          <Metric
                            label="Reliability"
                            value={`${candidate.reliabilityIndicators.reliabilityScore.toFixed(2)}`}
                          />
                        </div>
                        <div className="grid gap-2 md:grid-cols-3 text-xs text-muted-foreground">
                          <p>Skill: {candidate.scoreBreakdown.skillMatch.toFixed(2)}</p>
                          <p>Schedule fit: {candidate.scoreBreakdown.scheduleFit.toFixed(2)}</p>
                          <p>Travel efficiency: {candidate.scoreBreakdown.travelEfficiency.toFixed(2)}</p>
                          <p>Customer preference: {candidate.scoreBreakdown.customerPreference.toFixed(2)}</p>
                          <p>Punctuality: {candidate.reliabilityIndicators.punctualityScore.toFixed(2)}</p>
                          <p>Complaint rate: {candidate.reliabilityIndicators.complaintRate.toFixed(2)}</p>
                        </div>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {candidate.feasibilityNotes.map((note) => (
                            <li key={note}>• {note}</li>
                          ))}
                        </ul>
                        <form action={overrideAssignment}>
                          <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                          <input type="hidden" name="providerId" value={candidate.providerId} />
                          <input type="hidden" name="reasonCode" value="FORCE_ASSIGNED_COVERAGE_EXTENSION" />
                          <Button type="submit" variant="outline" size="sm">
                            Force assign
                          </Button>
                        </form>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Filtered out</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ranking?.filteredOut.length ? ranking.filteredOut.map((candidate) => (
                    <div key={candidate.providerId} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{candidate.providerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {candidate.filteredReasonCodes.join(', ')}
                      </p>
                    </div>
                  )) : (
                    <p className="text-sm text-muted-foreground">
                      No filtered candidates were recorded for this ranking.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Dispatch history</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No dispatch history yet.</p>
                  ) : (
                    history.map((entry) => (
                      <div key={entry.dispatchDecision.id} className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{entry.dispatchDecision.mode}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.dispatchDecision.status}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Considered {entry.dispatchDecision.consideredCount} · eligible {entry.dispatchDecision.eligibleCount}
                        </p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {entry.attempts.slice(0, 5).map((attempt) => (
                            <li key={attempt.id}>
                              {attempt.providerId} · {attempt.stage}
                              {attempt.score != null ? ` · ${attempt.score.toFixed(3)}` : ''}
                              {attempt.reasonCode ? ` · ${attempt.reasonCode}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {requestAuditTrail.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Audit trail</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {requestAuditTrail.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0 tabular-nums">{formatDispatchAge(entry.timestamp)}</span>
                        <span className="font-medium text-foreground/70">{entry.action.replace(/\./g, ' · ')}</span>
                        <span className="ml-auto shrink-0">{entry.actorRole}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {showCloseOut && dispatchCaseFull && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Case</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ResolveCaseForm
                      caseId={dispatchCaseFull.id}
                      queueType="DISPATCH"
                      isResolved={['RESOLVED', 'CANCELLED'].includes(dispatchCaseFull.state)}
                      reasonCodes={dispatchReasonCodes}
                      resolveAction={closeCaseAction}
                      reopenAction={reopenCaseAction}
                      claimAction={claimCaseAction}
                      ownerUserId={dispatchCaseFull.ownerUserId}
                      currentUserId={admin.id}
                    />
                    <Separator />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Notes</p>
                      <CaseNotesPanel notes={dispatchCaseFull.notes} addNoteAction={addNoteAction} />
                    </div>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Activity</p>
                      <CaseActivityTimeline events={dispatchCaseFull.events} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-sm text-muted-foreground">
                Select a service request to inspect ranked technicians.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function formatDispatchAge(date: Date) {
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.max(0, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function ageMinutes(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000))
}

function slaToneVariant(tone: 'default' | 'warning' | 'danger') {
  if (tone === 'danger') return 'danger' as const
  if (tone === 'warning') return 'warning' as const
  return 'outline' as const
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
