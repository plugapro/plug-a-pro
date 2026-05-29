// Provider: Submit quote for a matched job
export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { buildMetadata } from '@/lib/metadata'
import { QuoteForm } from '@/components/technician/QuoteForm'
import { Button } from '@/components/ui/button'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { AlertCallout } from '@/components/shared/AlertCallout'
import { ChevronLeft } from 'lucide-react'

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
    <div className="min-h-screen pb-32 screen-enter">
      {/* Page header */}
      <div className="px-[18px] pt-[60px] pb-4 flex items-center gap-3">
        <Link href="/provider" aria-label="Back to dashboard">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <ChevronLeft className="w-5 h-5" style={{ color: 'var(--ink)' }} />
          </div>
        </Link>
        <div className="flex-1">
          <p
            className="text-[11px] font-bold tracking-[0.08em] uppercase"
            style={{ color: 'var(--brand-purple)' }}
          >
            Quote
          </p>
          <h1
            className="text-[28px] font-bold tracking-[-0.025em]"
            style={{ color: 'var(--ink)' }}
          >
            Submit Quote
          </h1>
        </div>
      </div>

      <div className="px-[18px] space-y-3">
        {/* Customer contact */}
        <div
          className="rounded-[20px] p-5 space-y-3 text-sm"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <div>
            <p
              className="text-[11px] font-bold tracking-[0.08em] uppercase mb-3"
              style={{ color: 'var(--ink-mute)' }}
            >
              Customer contact
            </p>
            <p className="mt-1 font-medium" style={{ color: 'var(--ink)' }}>{jobRequest.customer.name}</p>
            <p style={{ color: 'var(--ink-mute)' }}>{jobRequest.customer.phone}</p>
          </div>
          <Button asChild className="w-full">
            <a href={contactUrl} target="_blank" rel="noopener noreferrer">
              Contact Customer
            </a>
          </Button>
        </div>

        {match.inspectionNeeded && match.status === 'INSPECTION_SCHEDULED' && (
          <AlertCallout tone="warning" title="Inspection still needs to be completed">
            <p>Mark the site visit complete before submitting the quote. This records the inspection step in the lifecycle.</p>
            <form action={markInspectionComplete} className="mt-3">
              <input type="hidden" name="matchId" value={matchId} />
              <FormSubmitButton className="w-full" pendingLabel="Marking…">Mark inspection complete</FormSubmitButton>
            </form>
          </AlertCallout>
        )}

        {quoteAwaitingDecision && latestQuote && (
          <AlertCallout tone="neutral" title="Quote awaiting customer decision">
            Your latest quote for R {Number(latestQuote.amount).toFixed(2)} has been sent to the customer.
            Wait for them to accept or decline before sending another one.
          </AlertCallout>
        )}

        {quoteCanBeRevised && latestQuote && (
          <AlertCallout tone="info" title="Revise and resend your quote">
            <p>The previous quote was not accepted. Review the scope, update your pricing and send a revised quote.</p>
            {latestQuote.notes && (
              <div className="mt-3 rounded-lg border border-current/20 bg-black/10 px-3 py-2 dark:bg-white/5">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Customer feedback</p>
                <p className="mt-1 text-sm">{latestQuote.notes}</p>
              </div>
            )}
          </AlertCallout>
        )}

        {quoteApproved && (
          <AlertCallout tone="success" title="Quote already approved">
            This job has already moved past the quote stage. Open the provider dashboard to continue execution.
          </AlertCallout>
        )}

        {match.quotes.length > 0 && (
          <div className="space-y-3">
            <div>
              <h2
                className="text-[11px] font-bold tracking-[0.08em] uppercase mb-1"
                style={{ color: 'var(--ink-mute)' }}
              >
                Quote history
              </h2>
              <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
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
          <div
            className="rounded-[20px] p-5 space-y-3"
            style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
          >
            <div>
              <h2
                className="text-[11px] font-bold tracking-[0.08em] uppercase mb-1"
                style={{ color: 'var(--ink-mute)' }}
              >
                Customer photos
              </h2>
              <p className="text-sm" style={{ color: 'var(--ink-mute)' }}>
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
    </div>
  )
}
