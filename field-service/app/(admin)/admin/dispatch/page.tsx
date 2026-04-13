export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  getDispatchHistory,
  manualOverrideAssignment,
  rankCandidatesForJobRequest,
  runAssignmentForJobRequest,
} from '@/lib/matching/service'
import { buildMetadata } from '@/lib/metadata'
import {
  OPS_QUEUE_TYPES,
  claimOpsQueueItem,
  formatOpsQueueOwnerLabel,
  listOpsQueueAssignments,
  releaseOpsQueueItem,
} from '@/lib/ops-queue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/StatusBadge'

export const metadata = buildMetadata({ title: 'Dispatch', noIndex: true })

export default async function AdminDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>
}) {
  const admin = await requireAdmin()
  const { request } = await searchParams

  const requests = await db.jobRequest.findMany({
    where: {
      status: { in: ['OPEN', 'MATCHING'] },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      address: true,
      match: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 30,
  })

  const assignments = await listOpsQueueAssignments(
    db,
    OPS_QUEUE_TYPES.DISPATCH,
    requests.map((jobRequest) => jobRequest.id),
  )

  const selectedRequest = request
    ? requests.find((jobRequest) => jobRequest.id === request) ??
      await db.jobRequest.findUnique({
        where: { id: request },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          address: true,
          match: true,
        },
      })
    : requests[0] ?? null

  async function runAutoAssign(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    await runAssignmentForJobRequest({
      jobRequestId,
      actor: { actorId: activeAdmin.id, actorRole: 'admin' },
      mode: 'AUTO_ASSIGN',
    })
    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
    redirect(`/admin/dispatch?request=${jobRequestId}`)
  }

  async function rerankForReview(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    await runAssignmentForJobRequest({
      jobRequestId,
      actor: { actorId: activeAdmin.id, actorRole: 'admin' },
      mode: 'OPS_REVIEW',
    })
    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
    redirect(`/admin/dispatch?request=${jobRequestId}`)
  }

  async function overrideAssignment(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    const providerId = String(formData.get('providerId') ?? '')
    await manualOverrideAssignment({
      jobRequestId,
      providerId,
      actor: { actorId: activeAdmin.id, actorRole: 'admin' },
      overrideReason: 'Selected by admin from dispatch console',
    })
    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
    redirect(`/admin/dispatch?request=${jobRequestId}`)
  }

  async function claimDispatch(formData: FormData) {
    'use server'
    const activeAdmin = await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    await claimOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.DISPATCH,
      entityId: jobRequestId,
      claimedById: activeAdmin.id,
      claimedByRole: activeAdmin.role,
      claimedByLabel: activeAdmin.email ?? 'admin',
    })

    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
    redirect(`/admin/dispatch?request=${jobRequestId}`)
  }

  async function releaseDispatch(formData: FormData) {
    'use server'
    await requireAdmin()
    const jobRequestId = String(formData.get('jobRequestId') ?? '')
    if (!jobRequestId) return

    await releaseOpsQueueItem(db, {
      queueType: OPS_QUEUE_TYPES.DISPATCH,
      entityId: jobRequestId,
    })

    revalidatePath('/admin/dispatch')
    revalidatePath('/admin')
    redirect(`/admin/dispatch?request=${jobRequestId}`)
  }

  const ranking = selectedRequest
    ? await rankCandidatesForJobRequest(selectedRequest.id).catch(() => null)
    : null
  const history = selectedRequest
    ? await getDispatchHistory(selectedRequest.id).catch(() => [])
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dispatch Console</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rank technicians, inspect schedule fit, and override the selected assignee when needed.
        </p>
      </div>

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
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  {!claimedByCurrentUser ? (
                    <form action={claimDispatch}>
                      <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                      <Button type="submit" variant="outline">
                        {assignment?.claimedById ? 'Take over dispatch' : 'Claim dispatch'}
                      </Button>
                    </form>
                  ) : (
                    <form action={releaseDispatch}>
                      <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                      <Button type="submit" variant="outline">
                        Release dispatch
                      </Button>
                    </form>
                  )}
                  <form action={runAutoAssign}>
                    <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                    <Button type="submit">Auto-assign top candidate</Button>
                  </form>
                  <form action={rerankForReview}>
                    <input type="hidden" name="jobRequestId" value={selectedRequest.id} />
                    <Button type="submit" variant="outline">
                      Refresh ranked shortlist
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
                          <Button type="submit" variant="outline" size="sm">
                            Override to this technician
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
