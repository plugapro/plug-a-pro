// ─── Provider: Job detail ──────────────────────────────────────────────────────
// Full job view: address, customer initial, status timeline, controls, extras form.
// Status transitions call POST /api/technician/jobs/[id]/status via client component.

export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { buildMetadata } from '@/lib/metadata'
import { JobStatusControls } from '@/components/technician/StatusControls'
import { PhotoUpload } from '@/components/technician/PhotoUpload'
import { ExtraWorkForm } from '@/components/technician/ExtraWorkForm'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({ title: 'Job Detail', noIndex: true })

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireProvider()
  const { id } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/technician')

  const job = await db.job.findUnique({
    where: { id },
    include: {
      booking: {
        include: {
          match: {
            include: {
              jobRequest: {
                include: {
                  customer: { select: { name: true, phone: true } },
                  address:  true,
                },
              },
            },
          },
          payment: { select: { status: true } },
        },
      },
      statusHistory: { orderBy: { timestamp: 'asc' } },
      extras:        { orderBy: { createdAt: 'desc' } },
      photos:        { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!job || job.providerId !== provider.id) notFound()

  const jobRequest = job.booking.match.jobRequest
  const customer   = jobRequest.customer
  const address    = jobRequest.address
  const b          = job.booking
  const customerFirst = customer.name.split(' ')[0]
  const disputes = await db.dispute.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: 'desc' },
  })
  const hasOpenDispute = disputes.some((dispute) => ['OPEN', 'UNDER_REVIEW'].includes(dispute.status))

  async function raiseDispute(formData: FormData) {
    'use server'
    const { requireProvider: getActiveProvider } = await import('@/lib/auth')
    const activeSession = await getActiveProvider()

    const activeProvider = await db.provider.findUnique({ where: { userId: activeSession.id } })
    if (!activeProvider) redirect('/technician')

    const reason = String(formData.get('reason') ?? '').trim()
    if (reason.length < 10) redirect(`/technician/jobs/${id}`)

    const freshJob = await db.job.findUnique({
      where: { id },
      select: { id: true, providerId: true },
    })
    if (!freshJob || freshJob.providerId !== activeProvider.id) redirect('/technician')

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
    }

    redirect(`/technician/jobs/${id}`)
  }

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-muted-foreground" asChild>
            <Link href="/technician">← Jobs</Link>
          </Button>
          <h1 className="text-xl font-semibold mt-1">
            Job #{job.id.slice(-8).toUpperCase()}
          </h1>
        </div>
        <StatusBadge status={job.status} type="job" />
      </div>

      {/* Job details */}
      <Card>
        <CardContent className="p-4 space-y-2 text-sm">
          <Row label="Customer">{customerFirst}</Row>
          {address && (
            <Row label="Address">
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(
                  `${address.street}, ${address.suburb}, ${address.city}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 underline"
              >
                {address.street}, {address.suburb}, {address.city}
              </a>
            </Row>
          )}
          {b.scheduledDate && (
            <Row label="Scheduled">
              {b.scheduledDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}
              {b.scheduledWindow ? ` · ${b.scheduledWindow}` : ''}
            </Row>
          )}
          {b.notes && <Row label="Notes">{b.notes}</Row>}
          <Row label="Ref">{job.bookingId.slice(-8).toUpperCase()}</Row>
        </CardContent>
      </Card>

      {/* Status controls — client component */}
      <JobStatusControls jobId={job.id} currentStatus={job.status} />

      {/* Status history */}
      {job.statusHistory.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            History
          </h2>
          <div className="space-y-1">
            {job.statusHistory.map((event) => (
              <div key={event.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
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
      {(['STARTED', 'ARRIVED', 'COMPLETED'] as const).includes(job.status as 'STARTED' | 'ARRIVED' | 'COMPLETED') && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Job photos
          </h2>

          {/* Existing photos */}
          {job.photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {job.photos.map((photo) => (
                <div key={photo.id} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/attachments/${photo.id}`}
                    alt={photo.label ?? 'Job photo'}
                    className="rounded-lg object-cover w-full h-40"
                  />
                  {photo.label && (
                    <p className="text-xs text-muted-foreground capitalize text-center">
                      {photo.label}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload controls — only when job is not yet completed */}
          {job.status !== 'COMPLETED' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Before</p>
                <PhotoUpload
                  jobId={job.id}
                  label="before"
                  existingUrl={job.photos.find((p) => p.label === 'before') ? `/api/attachments/${job.photos.find((p) => p.label === 'before')!.id}` : undefined}
                  onUploaded={() => {}}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">After</p>
                <PhotoUpload
                  jobId={job.id}
                  label="after"
                  existingUrl={job.photos.find((p) => p.label === 'after') ? `/api/attachments/${job.photos.find((p) => p.label === 'after')!.id}` : undefined}
                  onUploaded={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Extra work form — only while job is active */}
      {job.status === 'STARTED' && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Request extra work
          </h2>
          <ExtraWorkForm jobId={job.id} onSubmitted={() => {}} />
        </div>
      )}

      {/* Extra work requests */}
      {job.extras.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Extra work
          </h2>
          {job.extras.map((extra) => (
            <Card key={extra.id}>
              <CardContent className="p-3 text-sm">
                <div className="flex justify-between">
                  <p>{extra.description}</p>
                  <p className="font-medium">R {Number(extra.amount).toFixed(0)}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Status: <span className="capitalize">{extra.status.toLowerCase()}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="font-medium text-sm">Problem on this job?</p>
            <p className="text-sm text-muted-foreground">
              Raise it with Plug-A-Pro support so the written quote, photos, and job history can be reviewed.
            </p>
          </div>

          {disputes.length > 0 && (
            <div className="space-y-2">
              {disputes.map((dispute) => (
                <div key={dispute.id} className="rounded-lg border px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">Issue #{dispute.id.slice(-8).toUpperCase()}</p>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {dispute.status.replaceAll('_', ' ').toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{dispute.reason}</p>
                  {dispute.resolution && (
                    <p className="mt-2 text-xs text-muted-foreground">
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
              <Button type="submit" variant="outline" className="w-full">
                Raise an issue with support
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
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
