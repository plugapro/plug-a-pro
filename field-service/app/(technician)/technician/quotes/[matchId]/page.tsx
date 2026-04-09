// Provider: Submit quote for a matched job
export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { QuoteForm } from '@/components/technician/QuoteForm'
import { Button } from '@/components/ui/button'

export const metadata = buildMetadata({ title: 'Submit Quote', noIndex: true })

async function markInspectionComplete(formData: FormData) {
  'use server'

  const session = await requireProvider()
  const matchId = String(formData.get('matchId') ?? '')
  if (!matchId) return

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/technician')

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
    redirect('/technician')
  }

  if (match.status === 'INSPECTION_COMPLETE' || match.status === 'QUOTED') {
    redirect(`/technician/quotes/${matchId}`)
  }

  if (match.status !== 'INSPECTION_SCHEDULED') {
    redirect('/technician')
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
          notes: 'Marked complete from technician quote screen',
        },
      })
    }

    await tx.match.update({
      where: { id: matchId },
      data: { status: 'INSPECTION_COMPLETE' },
    })
  })

  redirect(`/technician/quotes/${matchId}`)
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const session = await requireProvider()
  const { matchId } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/technician')

  const match = await db.match.findUnique({
    where: { id: matchId },
    include: {
      jobRequest: { include: { address: true } },
      quotes: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  if (!match) notFound()
  if (match.providerId !== provider.id) redirect('/technician')

  if (match.quotes.length > 0 && match.status === 'QUOTED') {
    redirect('/technician?quote=already-sent')
  }

  const jobRequest = match.jobRequest
  const addr = jobRequest.address
  const area = addr ? `${addr.suburb ?? ''}${addr.city ? `, ${addr.city}` : ''}`.trim() : 'Location in app'

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-24">
      <div>
        <h1 className="text-xl font-semibold">Submit Quote</h1>
        <p className="text-sm text-muted-foreground mt-1">
          This quote will be sent to the customer for approval.
        </p>
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

      {(!match.inspectionNeeded || match.status === 'INSPECTION_COMPLETE' || match.status === 'QUOTED') && (
        <QuoteForm
          matchId={matchId}
          postInspection={match.inspectionNeeded}
          category={jobRequest.category}
          area={area}
          description={jobRequest.description}
        />
      )}
    </div>
  )
}
