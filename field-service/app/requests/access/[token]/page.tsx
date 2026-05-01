export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { buildMetadata } from '@/lib/metadata'
import { resolveJobRequestAccessToken } from '@/lib/job-request-access'
import { createTraceId } from '@/lib/support-diagnostics'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ProviderTrustSignals } from '@/components/shared/provider-trust-signals'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildProviderTrustSignals } from '@/lib/provider-trust'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'

export const metadata = buildMetadata({ title: 'Ticket Details', noIndex: true })

export default async function TicketAccessPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await resolveJobRequestAccessToken(token)

  if (result.status !== 'active' || !result.jobRequest) {
    const expired = result.status === 'expired'
    const code = expired ? 'TICKET_EXPIRED' : 'TICKET_INVALID'
    const traceId = createTraceId('tkt')
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <Card>
          <CardContent className="space-y-3 px-4 py-5 text-sm">
            <p className="font-semibold">
              {expired ? 'This ticket link has expired' : 'This ticket link is invalid'}
            </p>
            <p className="text-muted-foreground">
              For your privacy, direct ticket links can expire or be revoked. Sign in to view all your tickets.
            </p>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
              <span className="mr-2 font-semibold">Code:</span>{code}
              <br />
              <span className="mr-2 font-semibold">Ref:</span>{traceId}
            </div>
          </CardContent>
        </Card>
        <div className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/sign-in">Sign in to view your tickets</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You can also return to WhatsApp and ask Plug A Pro to resend your ticket link.
          </p>
        </div>
      </div>
    )
  }

  const jobRequest = result.jobRequest
  const match = jobRequest.match
  const latestQuote = match?.quotes[0] ?? null
  const booking = match?.booking ?? null
  const provider = match?.provider ?? null
  const providerSignals = provider
    ? buildProviderTrustSignals({
        marketplaceApproved: provider.verified,
        skills: provider.skills,
        serviceAreas: provider.serviceAreas,
        experience: provider.experience,
        evidenceNote: provider.evidenceNote,
      })
    : []

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Plug A Pro ticket</p>
          <h1 className="mt-1 text-xl font-semibold">Request #{jobRequest.id.slice(-8).toUpperCase()}</h1>
          <p className="text-sm capitalize text-muted-foreground">{jobRequest.category}</p>
        </div>
        <StatusBadge status={jobRequest.status} type="jobRequest" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Request
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{jobRequest.title}</p>
            <p className="mt-1 text-muted-foreground">{jobRequest.description}</p>
          </div>
          {jobRequest.address && (
            <Row label="Address">
              {jobRequest.address.street}, {jobRequest.address.suburb}, {jobRequest.address.city}
            </Row>
          )}
          <Row label="Created">
            {jobRequest.createdAt.toLocaleDateString('en-ZA', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Row>
          {jobRequest.attachments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Photos
              </p>
              <div className="grid grid-cols-2 gap-2">
                {jobRequest.attachments.map((photo) => {
                  const src = `/api/attachments/${photo.id}?token=${encodeURIComponent(token)}`
                  return (
                    <AttachmentThumbnail
                      key={photo.id}
                      attachmentId={photo.id}
                      src={src}
                      href={src}
                      alt={photo.caption ?? 'Customer photo'}
                      className="h-36 w-full rounded-lg object-cover"
                      fallbackText="Photo unavailable"
                      showDiagnostics={false}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {provider && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Matched provider
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{provider.name}</p>
                {provider.bio && <p className="mt-1 text-muted-foreground">{provider.bio}</p>}
              </div>
              {match && <StatusBadge status={match.status} type="match" />}
            </div>
            <ProviderTrustSignals signals={providerSignals} />
            <ProviderTrustNote marketplaceApproved={provider.verified} />
          </CardContent>
        </Card>
      )}

      {latestQuote && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Quote history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <QuoteHistoryTimeline
              audience="customer"
              quotes={match?.quotes.map((quote) => ({
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
                approvalToken: quote.approvalToken,
              })) ?? []}
            />
          </CardContent>
        </Card>
      )}

      {booking?.job && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Work evidence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Job status</p>
              <StatusBadge status={booking.job.status} type="job" />
            </div>
            {booking.job.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {booking.job.photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <AttachmentThumbnail
                      attachmentId={photo.id}
                      src={`/api/attachments/${photo.id}?token=${encodeURIComponent(token)}`}
                      href={`/api/attachments/${photo.id}?token=${encodeURIComponent(token)}`}
                      alt={photo.caption ?? 'Work evidence'}
                      className="h-40 w-full rounded-lg object-cover"
                      fallbackText="Photo unavailable"
                      showDiagnostics={false}
                    />
                    {photo.caption && (
                      <p className="text-xs text-muted-foreground">
                        {photo.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">
                The provider has not uploaded work photos yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 px-4 py-4 text-sm">
          <p className="font-medium">Need the full account view?</p>
          <p className="text-muted-foreground">
            This secure link only opens this ticket. Sign in if you want your wider request history or account tools.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/sign-in">Sign in to your account</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 flex-shrink-0 text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  )
}
