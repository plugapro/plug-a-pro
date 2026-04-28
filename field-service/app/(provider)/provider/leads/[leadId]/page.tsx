// Provider: Lead detail — view job info + accept/decline
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/auth'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { formatDistanceToNow, format } from 'date-fns'
import { getCategoryPolicy } from '@/lib/service-category-policy'

export const metadata = buildMetadata({ title: 'Lead Details', noIndex: true })

async function acceptLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')
  const inspectionNeeded = formData.get('inspectionNeeded') === 'true'

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const { acceptLead: accept } = await import('@/lib/matching-engine')
  const result = await accept({ leadId, providerId: provider.id, inspectionNeeded })

  if (!result.ok) {
    // Lead expired or taken — go back to leads list with the status visible
    redirect('/provider/leads')
  }

  redirect(`/provider/quotes/${result.matchId}`)
}

async function declineLead(formData: FormData) {
  'use server'
  const session = await requireProvider()
  const leadId = String(formData.get('leadId') ?? '')

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const { declineLead: decline } = await import('@/lib/matching-engine')
  await decline({ leadId, providerId: provider.id })

  redirect('/provider/leads')
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const session = await requireProvider()
  const { leadId } = await params

  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) redirect('/provider')

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      jobRequest: {
        include: {
          address: true,
          attachments: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!lead) notFound()
  if (lead.providerId !== provider.id) redirect('/provider/leads')

  // Mark as viewed if still SENT
  if (lead.status === 'SENT') {
    await db.lead.update({ where: { id: leadId }, data: { status: 'VIEWED' } })
  }

  const jr = lead.jobRequest
  const addr = jr.address
  const area = addr
    ? [addr.street, addr.suburb, addr.city].filter(Boolean).join(', ')
    : 'Location on file'

  const isExpired = lead.expiresAt ? lead.expiresAt < new Date() : false
  const isResponded = lead.status === 'ACCEPTED' || lead.status === 'DECLINED'
  const canAct = !isExpired && !isResponded

  // Hide "Inspection First" for simple categories where bookingOnAssignment is true
  // (e.g. garden, handyman, cleaning, diy) — these don't need a site visit before quoting.
  const categoryPolicy = getCategoryPolicy(jr.category)
  const showInspectionOption = !categoryPolicy.bookingOnAssignment

  return (
    <div className="px-4 py-6 space-y-5 max-w-lg mx-auto pb-28">
      {/* Header */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          New Lead · {lead.id.slice(-8).toUpperCase()}
        </p>
        <h1 className="text-xl font-semibold">{jr.category}</h1>
      </div>

      {/* Expiry banner */}
      {lead.expiresAt && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          isExpired
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {isExpired
            ? 'This lead has expired and can no longer be accepted.'
            : `Expires ${formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · ${format(lead.expiresAt, 'HH:mm, d MMM')}`}
        </div>
      )}

      {isResponded && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          You have already {lead.status === 'ACCEPTED' ? 'accepted' : 'declined'} this lead.
        </div>
      )}

      {/* Job details */}
      <div className="rounded-xl border bg-card divide-y">
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Category</p>
          <p className="font-medium">{jr.category}</p>
        </div>
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Location</p>
          <p className="font-medium">{area}</p>
        </div>
        {jr.description && (
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Description</p>
            <p className="text-sm">{jr.description}</p>
          </div>
        )}
        {jr.attachments.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer photos</p>
            <div className="grid grid-cols-2 gap-2">
              {jr.attachments.map((photo) => {
                const src = `/api/attachments/${photo.id}`
                return (
                  <AttachmentThumbnail
                    key={photo.id}
                    attachmentId={photo.id}
                    src={src}
                    href={src}
                    alt={photo.caption ?? 'Customer photo'}
                  />
                )
              })}
            </div>
          </div>
        )}
        <div className="px-4 py-3 space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
          <p className="text-sm text-muted-foreground">
            {format(lead.sentAt, 'HH:mm, d MMM yyyy')}
          </p>
        </div>
      </div>

      {/* Actions */}
      {canAct && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t px-4 py-4 space-y-2 safe-bottom">
          <form action={acceptLead} className="space-y-2">
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="inspectionNeeded" value="false" />
            <Button type="submit" size="lg" className="w-full">
              ✅ Accept &amp; Build Quote
            </Button>
          </form>

          {showInspectionOption && (
            <form action={acceptLead}>
              <input type="hidden" name="leadId" value={leadId} />
              <input type="hidden" name="inspectionNeeded" value="true" />
              <Button type="submit" size="lg" variant="outline" className="w-full">
                🔍 Inspection First
              </Button>
            </form>
          )}

          <form action={declineLead}>
            <input type="hidden" name="leadId" value={leadId} />
            <Button
              type="submit"
              size="lg"
              variant="ghost"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              ❌ Decline
            </Button>
          </form>
        </div>
      )}

      {/* Back */}
      <div className="pt-2">
        <Link href="/provider/leads" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to leads
        </Link>
      </div>
    </div>
  )
}
