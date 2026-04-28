// Provider: Submit quote for a matched job
export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { buildMetadata } from '@/lib/metadata'
import { QuoteForm } from '@/components/technician/QuoteForm'
import { Button } from '@/components/ui/button'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'

export const metadata = buildMetadata({ title: 'Submit Quote', noIndex: true })

async function markInspectionComplete(formData: FormData) {
  'use server'

  const session = await requireProvider()
  const matchId = String(formData.get('matchId') ?? '')
  if (!matchId) return

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      providerId: true,
      inspectionNeeded: true,
      status: true,
    },
  })

  if (!match || match.providerId !== provider.id || !match.inspectionNeeded) {
    redirect('/provider')
  }

  if (match.status === 'INSPECTION_COMPLETE' || match.status === 'QUOTED') {
    redirect(`/provider/quotes/${matchId}`)
  }

  if (match.status !== 'INSPECTION_SCHEDULED') {
    redirect('/provider')
  }

  await db.$transaction(async (tx) => {
    const inspection = await tx.inspectionSlot.findFirst({
      where: {
        matchId,
        status: { in: ['PROPOSED', 'CONFIRMED'] },
      },
      orderBy: { proposedAt: 'desc' },
    })

    if (inspection) {
      await tx.inspectionSlot.update({
        where: { id: inspection.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          confirmedAt: inspection.confirmedAt ?? new Date(),
        },
      })
    } else {
      await tx.inspectionSlot.create({
        data: {
          matchId,
          proposedAt: new Date(),
          confirmedAt: new Date(),
          completedAt: new Date(),
          status: 'COMPLETED',
          notes: 'Marked complete from provider quote screen',
        },
      })
    }

    await tx.match.update({
      where: { id: matchId },
      data: { status: 'INSPECTION_COMPLETE' },
    })
  })

  redirect(`/provider/quotes/${matchId}`)
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const session = await requireProvider()
  const { matchId } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      jobRequest: {
        include: {
          customer: { select: { name: true, phone: true } },
          address: true,
          attachments: { orderBy: { createdAt: 'asc' } },
        },
      },
      quotes: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!match) notFound()
  if (match.providerId !== provider.id) redirect('/provider')

  const latestQuote = match.quotes[0] ?? null

  const jobRequest = match.jobRequest
  const addr = jobRequest.address
  const area = addr ? `${addr.suburb ?? ''}${addr.city ? `, ${addr.city}` : ''}`.trim() : 'Location in app'
  const contactUrl = `https://wa.me/${jobRequest.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${jobRequest.customer.name.split(/\s+/)[0] || 'there'}, this is your Plug A Pro provider. I accepted your ${jobRequest.category} request and would like to confirm the details.`)}`
  const quoteAwaitingDecision = match.status === 'QUOTED' && latestQuote?.status === 'PENDING'
  const quoteCanBeRevised =
    match.status === 'QUOTE_DECLINED' ||
    latestQuote?.status === 'DECLINED' ||
    latestQuote?.status === 'EXPIRED'
  const quoteApproved = match.status === 'QUOTE_APPROVED' || latestQuote?.status === 'APPROVED'

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      <div>
        <h1 className="text-xl font-semibold">Submit Quote</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This quote will be sent to the customer for approval.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer contact</p>
          <p className="mt-1 font-medium">{jobRequest.customer.name}</p>
          <p className="text-muted-foreground">{jobRequest.customer.phone}</p>
        </div>
        <Button asChild className="w-full">
          <a href={contactUrl} target="_blank" rel="noopener noreferrer">
            Contact Customer
          </a>
        </Button>
      </div>

      {match.inspectionNeeded && match.status === 'INSPECTION_SCHEDULED' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm">
          <p className="font-medium text-amber-900">Inspection still needs to be completed</p>
          <p className="text-amber-800">
            Mark the site visit complete before submitting the quote. This records the inspection step in the lifecycle.
          </p>
          <form action={markInspectionComplete}>
            <input type="hidden" name="matchId" value={matchId} />
            <Button type="submit" className="w-full">Mark inspection complete</Button>
          </form>
        </div>
      )}

      {quoteAwaitingDecision && latestQuote && (
        <div className="rounded-xl border bg-muted/40 p-4 space-y-2 text-sm">
          <p className="font-medium">Quote awaiting customer decision</p>
          <p className="text-muted-foreground">
            Your latest quote for R {Number(latestQuote.amount).toFixed(2)} has been sent to the customer.
            Wait for them to accept or decline before sending another one.
          </p>
        </div>
      )}

      {quoteCanBeRevised && latestQuote && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2 text-sm">
          <p className="font-medium text-blue-900">Revise and resend your quote</p>
          <p className="text-blue-800">
            The previous quote was not accepted. Review the scope, update your pricing, and send a revised quote.
          </p>
          {latestQuote.notes && (
            <div className="rounded-lg border border-blue-200 bg-white/80 px-3 py-2 text-blue-900">
              <p className="text-xs font-semibold uppercase tracking-wide">Customer feedback</p>
              <p className="mt-1 text-sm">{latestQuote.notes}</p>
            </div>
          )}
        </div>
      )}

      {quoteApproved && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2 text-sm">
          <p className="font-medium text-green-900">Quote already approved</p>
          <p className="text-green-800">
            This job has already moved past the quote stage. Open the provider dashboard to continue execution.
          </p>
        </div>
      )}

      {match.quotes.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Quote history
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Every version sent to the customer, including revision reasons and current status.
            </p>
          </div>
          <QuoteHistoryTimeline
            audience="provider"
            quotes={match.quotes.map((quote) => ({
              id: quote.id,
              amount: Number(quote.amount),
              labourCost: Number(quote.labourCost),
              materialsCost: Number(quote.materialsCost),
              description: quote.description,
              status: quote.status,
              estimatedHours: quote.estimatedHours,
              preferredDate: quote.preferredDate,
              validUntil: quote.validUntil,
              createdAt: quote.createdAt,
              approvedAt: quote.approvedAt,
              declinedAt: quote.declinedAt,
              notes: quote.notes,
            }))}
          />
        </div>
      )}

      {jobRequest.attachments.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-medium">Customer photos</h2>
            <p className="text-sm text-muted-foreground">
              Use these photos to understand the problem before quoting.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {jobRequest.attachments.map((photo) => {
              const src = `/api/attachments/${photo.id}`
              return (
                <AttachmentThumbnail
                  key={photo.id}
                  attachmentId={photo.id}
                  src={src}
                  href={src}
                  alt={photo.caption ?? 'Customer photo'}
                  className="h-36 w-full rounded-lg object-cover"
                />
              )
            })}
          </div>
        </div>
      )}

      {(!quoteAwaitingDecision && !quoteApproved && (!match.inspectionNeeded || match.status === 'INSPECTION_COMPLETE' || quoteCanBeRevised)) && (
        <QuoteForm
          matchId={matchId}
          postInspection={match.inspectionNeeded}
          category={jobRequest.category}
          area={area}
          description={jobRequest.description}
          basePath="/provider"
        />
      )}
    </div>
  )
}
