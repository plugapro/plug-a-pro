export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { format, formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { getCategoryPolicy } from '@/lib/service-category-policy'
import { db } from '@/lib/db'
import { resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'

async function acceptLeadWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const inspectionNeeded = formData.get('inspectionNeeded') === 'true'

  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=invalid`)
  }

  const lead = resolved.lead
  if ((lead.expiresAt && lead.expiresAt <= new Date()) || lead.status === 'ACCEPTED' || lead.status === 'DECLINED') {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=closed`)
  }

  const { acceptLead } = await import('@/lib/matching-engine')
  const result = await acceptLead({ leadId: lead.id, providerId: lead.providerId, inspectionNeeded })

  if (!result.ok) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=${result.reason.toLowerCase()}`)
  }

  const next = result.matchId ? `/provider/quotes/${result.matchId}` : '/provider/leads'
  redirect(`/provider-sign-in?next=${encodeURIComponent(next)}`)
}

async function declineLeadWithToken(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')

  const resolved = await resolveProviderLeadAccessToken(token)
  if (resolved.status !== 'active' || !resolved.lead) {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=invalid`)
  }

  const lead = resolved.lead
  if ((lead.expiresAt && lead.expiresAt <= new Date()) || lead.status === 'ACCEPTED' || lead.status === 'DECLINED') {
    redirect(`/leads/access/${encodeURIComponent(token)}?error=closed`)
  }

  const { declineLead } = await import('@/lib/matching-engine')
  await declineLead({ leadId: lead.id, providerId: lead.providerId })
  redirect(`/leads/access/${encodeURIComponent(token)}?declined=1`)
}

function ClosedLeadMessage({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <p className="text-sm font-semibold">Plug A Pro</p>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">
        <div className="rounded-lg border bg-card px-4 py-5 space-y-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            This lead can no longer be accepted. New leads will be sent to you on WhatsApp as they become available.
          </p>
        </div>
      </main>
    </div>
  )
}

export default async function ProviderLeadAccessPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const resolved = await resolveProviderLeadAccessToken(token)

  if (resolved.status === 'expired') {
    return <ClosedLeadMessage title="This secure lead link has expired." />
  }

  if (resolved.status !== 'active' || !resolved.lead) {
    return <ClosedLeadMessage title="This secure lead link is invalid." />
  }

  const lead = resolved.lead
  const jr = lead.jobRequest
  const addr = jr.address
  const isExpired = lead.expiresAt ? lead.expiresAt < new Date() : false
  const isResponded = lead.status === 'ACCEPTED' || lead.status === 'DECLINED'

  if (isExpired || isResponded) {
    return (
      <ClosedLeadMessage
        title={
          isExpired
            ? 'This lead has expired.'
            : `This lead has already been ${lead.status === 'ACCEPTED' ? 'accepted' : 'declined'}.`
        }
      />
    )
  }

  if (lead.status === 'SENT') {
    await db.lead.update({ where: { id: lead.id }, data: { status: 'VIEWED' } })
  }

  const area = addr
    ? [addr.street, addr.suburb, addr.city, addr.province].filter(Boolean).join(', ')
    : 'Location on file'
  const categoryPolicy = getCategoryPolicy(jr.category)
  const showInspectionOption = !categoryPolicy.bookingOnAssignment
  const attachmentToken = encodeURIComponent(token)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <p className="text-sm font-semibold">Plug A Pro</p>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 pb-36 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            New Lead · {lead.id.slice(-8).toUpperCase()}
          </p>
          <h1 className="text-xl font-semibold">{jr.title || jr.category}</h1>
        </div>

        {lead.expiresAt && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Expires {formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · {format(lead.expiresAt, 'HH:mm, d MMM')}
          </div>
        )}

        <div className="rounded-lg border bg-card divide-y">
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
              <p className="text-sm whitespace-pre-line">{jr.description}</p>
            </div>
          )}
          {jr.attachments.length > 0 && (
            <div className="px-4 py-3 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Customer photos</p>
              <div className="grid grid-cols-2 gap-2">
                {jr.attachments.map((photo) => (
                  <a
                    key={photo.id}
                    href={`/api/attachments/${photo.id}?leadToken=${attachmentToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/attachments/${photo.id}?leadToken=${attachmentToken}`}
                      alt={photo.caption ?? photo.label ?? 'Customer job photo'}
                      className="h-32 w-full rounded-lg object-cover"
                    />
                  </a>
                ))}
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
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 px-4 py-4 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-lg space-y-2">
          <form action={acceptLeadWithToken}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="inspectionNeeded" value="false" />
            <Button type="submit" size="lg" className="w-full">
              Accept &amp; Build Quote
            </Button>
          </form>

          {showInspectionOption && (
            <form action={acceptLeadWithToken}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="inspectionNeeded" value="true" />
              <Button type="submit" size="lg" variant="outline" className="w-full">
                Inspection First
              </Button>
            </form>
          )}

          <form action={declineLeadWithToken}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" size="lg" variant="ghost" className="w-full text-destructive hover:text-destructive">
              Decline
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
