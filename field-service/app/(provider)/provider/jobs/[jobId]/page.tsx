// ─── Provider: Job detail ──────────────────────────────────────────────────────
// Full job view: address, customer initial, status timeline, controls, extras form.
// Status transitions call POST /api/technician/jobs/[id]/status via client component.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { recordAuditLog } from '@/lib/audit'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { PhoneLink } from '@/components/shared/PhoneLink'
import { buildMetadata } from '@/lib/metadata'
import { JobStatusControls } from '@/components/technician/StatusControls'
import { EvidenceUploader } from '@/components/technician/EvidenceUploader'
import { ExtraWorkForm } from '@/components/technician/ExtraWorkForm'
import { Button } from '@/components/ui/button'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { ChevronLeft } from 'lucide-react'
import { getProviderJobDetailForViewer } from '@/lib/booking-detail-loaders'
import {
  PROVIDER_COMPLETED_JOB_STATUSES,
  PROVIDER_IN_PROGRESS_JOB_STATUSES,
  PROVIDER_UPCOMING_JOB_STATUSES,
} from '@/lib/provider-job-status'

export const metadata = buildMetadata({ title: 'Job Detail', noIndex: true })

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>
}) {
  const session = await requireProvider()
  const { jobId: id } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const detail = await getProviderJobDetailForViewer({
    route: '/provider/jobs/[jobId]',
    viewerUserId: session.id,
    viewerProviderId: provider.id,
    jobId: id,
  })

  if (!detail.ok) {
    if (process.env.NODE_ENV !== 'production') {
      // Keep provider-facing UX consistent while surfacing the exact blocker in local
      // logs so support can quickly distinguish missing jobs from permission and API issues.
      console.warn('[provider/jobs] detail load blocked', {
        route: '/provider/jobs/[jobId]',
        jobId: id,
        reason: detail.error,
      })
    }

    return (
      <div className="min-h-screen px-[18px] pt-[80px] pb-10">
        <div className="rounded-[20px] bg-card p-5 shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="text-sm font-semibold text-[var(--ink)]">Could not load this job right now.</p>
          <p className="mt-1 text-[13px] text-[var(--ink-mute)]">
            Please go back to your jobs list and try again.
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href="/provider/jobs">Back to jobs</Link>
          </Button>
        </div>
      </div>
    )
  }

  const { job, booking: b, addressDisplay, mapQuery, scheduledDateLabel, customerFirstName } = detail.data
  if (id !== job.id) {
    // Canonicalize route ids so follow-up actions (status updates/disputes)
    // always operate on the immutable execution job id.
    redirect(`/provider/jobs/${job.id}`)
  }

  const disputes = await db.dispute.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: 'desc' },
  })
  const hasOpenDispute = disputes.some((dispute) => ['OPEN', 'UNDER_REVIEW'].includes(dispute.status))

  const serviceName = b.match?.jobRequest?.category ?? 'Service'
  const canShowCustomerPhone = new Set<string>([
    ...PROVIDER_UPCOMING_JOB_STATUSES,
    ...PROVIDER_IN_PROGRESS_JOB_STATUSES,
    ...PROVIDER_COMPLETED_JOB_STATUSES,
  ]).has(job.status)

  const customerPhone = canShowCustomerPhone ? b.match?.jobRequest?.customer?.phone : null

  async function raiseDispute(formData: FormData) {
    'use server'
    const { requireProvider: getActiveProvider } = await import('@/lib/auth')
    const activeSession = await getActiveProvider()

    const activeProvider = await db.provider.findUnique({ where: { userId: activeSession.id } })
    if (!activeProvider) redirect('/provider')

    const reason = String(formData.get('reason') ?? '').trim()
    if (reason.length < 10) redirect(`/provider/jobs/${job.id}`)

    const freshJob = await db.job.findUnique({
      where: { id: job.id },
      select: { id: true, providerId: true },
    })
    if (!freshJob || freshJob.providerId !== activeProvider.id) redirect('/provider')

    const existing = await db.dispute.findFirst({
      where: {
        jobId: freshJob.id,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
      select: { id: true },
    })

    if (!existing) {
      await db.dispute.create({
        data: {
          jobId: freshJob.id,
          raisedById: activeSession.id,
          raisedByRole: 'provider',
          reason,
          status: 'OPEN',
        },
      })

      await recordAuditLog({
        actorId: activeSession.id,
        actorRole: 'provider',
        action: 'dispute.raise',
        entityType: 'job',
        entityId: freshJob.id,
        after: {
          disputeRaised: true,
          raisedByRole: 'provider',
          reason,
        },
      })
    }

    redirect(`/provider/jobs/${job.id}`)
  }

  return (
    <div className="min-h-screen pb-32 screen-enter">
      {/* Page header */}
      <div className="px-[18px] pt-[60px] pb-4 flex items-center gap-3">
        <Link href="/provider/jobs" aria-label="Back to jobs">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <ChevronLeft className="w-5 h-5" style={{ color: 'var(--ink)' }} />
          </div>
        </Link>
        <h1
          className="text-[28px] font-bold tracking-[-0.025em] flex-1"
          style={{ color: 'var(--ink)' }}
        >
          Job #{job.id.slice(-8).toUpperCase()}
        </h1>
        <StatusBadge status={job.status} type="job" />
      </div>

      <div className="px-[18px] space-y-3">
        {/* Job details */}
        <div
          className="rounded-[20px] p-5 space-y-2 text-sm"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <Row label="Service">{serviceName}</Row>
          <Row label="Customer">{customerFirstName}</Row>
          {customerPhone ? (
            <Row label="Contact">
              <PhoneLink
                href={`tel:${customerPhone}`}
                source="provider_job_call_customer"
                ctaLabel="Call customer"
                className="underline-offset-4 hover:underline"
                aria-label={`Call ${customerFirstName}`}
              >
                {customerPhone}
              </PhoneLink>
            </Row>
          ) : null}
          {addressDisplay && (
            <Row label="Address">
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(
                  mapQuery ??
                  addressDisplay
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {addressDisplay}
              </a>
            </Row>
          )}
          {scheduledDateLabel && (
            <Row label="Scheduled">
              {scheduledDateLabel}
            </Row>
          )}
          {b.notes && <Row label="Notes">{b.notes}</Row>}
          <Row label="Ref">{job.bookingId.slice(-8).toUpperCase()}</Row>
        </div>

        {/* Completion note - shown once job is awaiting or completed */}
        {(['PENDING_COMPLETION_CONFIRMATION', 'COMPLETED'] as const).includes(
          job.status as 'PENDING_COMPLETION_CONFIRMATION' | 'COMPLETED'
        ) && (job as any).completionNote && (
          <div
            className="rounded-[20px] p-5 space-y-1"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <p
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              Completion note
            </p>
            <p className="text-sm">{(job as any).completionNote}</p>
            {(job as any).completedAt && (
              <p className="text-xs" style={{ color: 'var(--ink-mute)' }}>
                Completed {(job as any).completedAt.toLocaleString('en-ZA', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
        )}

        {/* Status controls - client component */}
        <JobStatusControls jobId={job.id} currentStatus={job.status} />

        {/* Status history */}
        {job.statusHistory.length > 0 && (
          <div className="space-y-2">
            <h2
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              History
            </h2>
            <div className="space-y-1">
              {job.statusHistory.map((event) => (
                <div key={event.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-mute)' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--brand-purple)' }} />
                  <span>{event.timestamp.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>→</span>
                  <span className="capitalize">{event.toStatus.replace(/_/g, ' ').toLowerCase()}</span>
                  {event.notes && <span className="italic">({event.notes})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Photos section */}
        {(['STARTED', 'ARRIVED', 'PENDING_COMPLETION_CONFIRMATION', 'COMPLETED'] as const).includes(job.status as 'STARTED' | 'ARRIVED' | 'PENDING_COMPLETION_CONFIRMATION' | 'COMPLETED') && (
          <div className="space-y-3">
            <h2
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              Job photos
            </h2>

            {/* Existing photos */}
            {job.photos.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {job.photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <AttachmentThumbnail
                      attachmentId={photo.id}
                      src={`/api/attachments/${photo.id}`}
                      alt={photo.label ?? 'Job photo'}
                      className="rounded-lg object-cover w-full h-40"
                    />
                    {(photo.caption || photo.label) && (
                      <p className="text-xs capitalize text-center" style={{ color: 'var(--ink-mute)' }}>
                        {photo.caption ?? photo.label}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Upload controls - only when job is not yet completed */}
            {!['COMPLETED', 'CANCELLED'].includes(job.status) && (
              <EvidenceUploader jobId={job.id} />
            )}
          </div>
        )}

        {/* Extra work form - only while job is active */}
        {job.status === 'STARTED' && (
          <div className="space-y-3">
            <h2
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              Request extra work
            </h2>
            <ExtraWorkForm jobId={job.id} onSubmitted={() => {}} />
          </div>
        )}

        {/* Extra work requests */}
        {job.extras.length > 0 && (
          <div className="space-y-2">
            <h2
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              Extra work
            </h2>
            {job.extras.map((extra) => (
              <div
                key={extra.id}
                className="rounded-[20px] p-5 text-sm"
                style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
              >
                <div className="flex justify-between">
                  <p>{extra.description}</p>
                  <p className="font-medium">R {Number(extra.amount).toFixed(0)}</p>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--ink-mute)' }}>
                  Status: <span className="capitalize">{extra.status.toLowerCase()}</span>
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Dispute section */}
        <div
          className="rounded-[20px] p-5 space-y-3"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <div>
            <p
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              Problem on this job?
            </p>
            <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
              Raise it with Plug A Pro support so the written quote, photos and job history can be reviewed.
            </p>
          </div>

          {disputes.length > 0 && (
            <div className="space-y-2">
              {disputes.map((dispute) => (
                <div
                  key={dispute.id}
                  className="rounded-[20px] px-4 py-3 text-sm"
                  style={{ boxShadow: 'inset 0 0 0 1px var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">Issue #{dispute.id.slice(-8).toUpperCase()}</p>
                    <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--ink-mute)' }}>
                      {dispute.status.replaceAll('_', ' ').toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-2" style={{ color: 'var(--ink-mute)' }}>{dispute.reason}</p>
                  {dispute.resolution && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--ink-mute)' }}>
                      Resolution: {dispute.resolution}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {!hasOpenDispute && (
            <form action={raiseDispute} className="space-y-3">
              <textarea
                name="reason"
                minLength={10}
                required
                placeholder="Describe the issue so support can review it."
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <FormSubmitButton variant="outline" className="w-full" pendingLabel="Sending…">
                Raise an issue with support
              </FormSubmitButton>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-24 flex-shrink-0">{label}</span>
      <span>{children}</span>
    </div>
  )
}
