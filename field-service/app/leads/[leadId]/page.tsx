export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { buildMetadata } from '@/lib/metadata'
import { Button } from '@/components/ui/button'
import { format, formatDistanceToNow } from 'date-fns'

export const metadata = buildMetadata({ title: 'Lead Details', noIndex: true })

export default async function PublicLeadViewPage({
  params,
}: {
  params: Promise<{ leadId: string }>
}) {
  const { leadId } = await params

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      jobRequest: {
        include: {
          address: { select: { suburb: true, city: true, province: true } },
        },
      },
    },
  })

  if (!lead) notFound()

  const jr = lead.jobRequest
  const addr = jr.address
  const area = addr
    ? [addr.suburb, addr.city, addr.province].filter(Boolean).join(', ')
    : 'Location on file'

  const isExpired = lead.expiresAt ? lead.expiresAt < new Date() : false
  const isResponded = lead.status === 'ACCEPTED' || lead.status === 'DECLINED'

  const signInUrl = `/provider-sign-in?next=${encodeURIComponent(`/provider/leads/${leadId}`)}`

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center px-4">
          <p className="text-sm font-semibold">Plug A Pro</p>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            New Lead · {lead.id.slice(-8).toUpperCase()}
          </p>
          <h1 className="text-xl font-semibold">{jr.category}</h1>
        </div>

        {lead.expiresAt && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            isExpired
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            {isExpired
              ? 'This lead has expired.'
              : `Expires ${formatDistanceToNow(lead.expiresAt, { addSuffix: true })} · ${format(lead.expiresAt, 'HH:mm, d MMM')}`}
          </div>
        )}

        {isResponded && (
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            You have already {lead.status === 'ACCEPTED' ? 'accepted' : 'declined'} this lead.
          </div>
        )}

        <div className="rounded-xl border bg-card divide-y">
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Service</p>
            <p className="font-medium">{jr.category}</p>
          </div>
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Area</p>
            <p className="font-medium">{area}</p>
          </div>
          {jr.description && (
            <div className="px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Description</p>
              <p className="text-sm">{jr.description}</p>
            </div>
          )}
          <div className="px-4 py-3 space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Received</p>
            <p className="text-sm text-muted-foreground">
              {format(lead.sentAt, 'HH:mm, d MMM yyyy')}
            </p>
          </div>
        </div>

        {!isExpired && !isResponded && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Sign in to accept or decline this lead
            </p>
            <Button asChild size="lg" className="w-full">
              <Link href={signInUrl}>Sign in to respond</Link>
            </Button>
          </div>
        )}

        {isExpired && (
          <p className="text-center text-sm text-muted-foreground">
            New leads will be sent to you via WhatsApp as they come in.
          </p>
        )}
      </div>
    </div>
  )
}
