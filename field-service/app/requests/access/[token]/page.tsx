export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildMetadata } from '@/lib/metadata'
import { resolveJobRequestAccessToken } from '@/lib/job-request-access'
import { resolveClientPwaDestination } from '@/lib/client-pwa-destination'
import { createTraceId } from '@/lib/support-diagnostics'
import { QuoteHistoryTimeline } from '@/components/quotes/QuoteHistoryTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ProviderTrustNote } from '@/components/shared/provider-trust-note'
import { ProviderTrustSignals } from '@/components/shared/provider-trust-signals'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildProviderTrustSignals } from '@/lib/provider-trust'
import { AttachmentThumbnail } from '@/components/shared/AttachmentThumbnail'
import { normaliseLocationDisplayName } from '@/lib/location-format'
import {
  cancelRequestFromShortlist,
  getCustomerShortlistForRequest,
  requestMoreShortlistOptions,
  selectShortlistedProviderForRequest,
} from '@/lib/customer-shortlists'

export const metadata = buildMetadata({ title: 'Ticket Details', noIndex: true })

async function selectShortlistProvider(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const shortlistItemId = String(formData.get('shortlistItemId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await selectShortlistedProviderForRequest({ requestId, shortlistItemId })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=provider-confirming`)
}

async function askForMoreShortlistOptions(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await requestMoreShortlistOptions({ requestId })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=more-options-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=more-options`)
}

async function cancelRequestAction(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const requestId = String(formData.get('requestId') ?? '')
  const resolved = await resolveJobRequestAccessToken(token)

  if (resolved.status !== 'active' || resolved.jobRequest?.id !== requestId) {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=invalid`)
  }

  try {
    await cancelRequestFromShortlist({ requestId })
  } catch {
    redirect(`/requests/access/${encodeURIComponent(token)}?selection=cancel-failed`)
  }

  redirect(`/requests/access/${encodeURIComponent(token)}?selection=cancelled`)
}

function formatCurrency(amount: number | null) {
  if (amount == null) return 'Not provided'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount)
}

function formatDateTime(value: Date | null) {
  if (!value) return 'Not provided'
  return value.toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function TicketAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ intent?: string; selection?: string; view?: string }>
}) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const destination = await resolveClientPwaDestination({
    token,
    intendedScreen: resolvedSearchParams.view ?? resolvedSearchParams.intent ?? null,
  })

  if (destination.accessLevel !== 'public_token' || !destination.request) {
    const expired = destination.accessLevel === 'expired'
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

  const jobRequest = destination.request
  const shortlist = await getCustomerShortlistForRequest(jobRequest.id)
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
              {jobRequest.address.street}, {normaliseLocationDisplayName(jobRequest.address.suburb)}, {normaliseLocationDisplayName(jobRequest.address.city)}
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

      {resolvedSearchParams.selection === 'provider-confirming' && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-emerald-900">
            <p className="font-medium">Provider selected</p>
            <p>We are asking them to confirm the job now. You will be notified once accepted.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'failed' && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-destructive">
            <p className="font-medium">Selection could not be completed</p>
            <p>Please refresh this link or ask Plug A Pro for help in WhatsApp.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'more-options' && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-amber-900">
            <p className="font-medium">Looking for more options</p>
            <p>We are reaching out to additional providers. We&apos;ll update you here when more responses come in.</p>
          </CardContent>
        </Card>
      )}

      {resolvedSearchParams.selection === 'cancelled' && (
        <Card className="border-muted-foreground/30 bg-muted">
          <CardContent className="space-y-1 px-4 py-4 text-sm text-muted-foreground">
            <p className="font-medium">Request cancelled</p>
            <p>Your request has been cancelled. No credits were used and no providers were notified beyond the initial preview.</p>
          </CardContent>
        </Card>
      )}

      {shortlist && shortlist.items.length > 0 && !match && (
        <section className="space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Provider shortlist
            </p>
            <h2 className="mt-1 text-lg font-semibold">Choose a provider</h2>
          </div>
          <div className="space-y-3">
            {shortlist.items.map((item) => {
              const selected = Boolean(item.customerSelectedAt) || jobRequest.selectedLeadInviteId === item.leadInviteId
              const signals = buildProviderTrustSignals({
                marketplaceApproved: item.provider.verified,
                skills: item.provider.skills,
                experience: item.provider.experience,
                evidenceNote: item.provider.evidenceNote,
                completedJobs: item.provider.completedJobsCount,
                averageRating: item.provider.averageRating,
              })
              return (
                <Card key={item.id} className={selected ? 'border-primary' : undefined}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{item.provider.name}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.provider.verified ? 'Application reviewed' : 'Provider-supplied profile'}
                        </p>
                      </div>
                      {item.provider.avatarUrl && (
                        <div
                          aria-label={`${item.provider.name} profile photo`}
                          className="h-12 w-12 rounded-full bg-cover bg-center"
                          role="img"
                          style={{ backgroundImage: `url(${item.provider.avatarUrl})` }}
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {item.provider.bio && <p className="text-muted-foreground">{item.provider.bio}</p>}
                    <div className="grid grid-cols-2 gap-2">
                      <MiniStat label="Call-out fee" value={formatCurrency(item.callOutFee)} />
                      <MiniStat label="Arrival" value={formatDateTime(item.estimatedArrivalAt)} />
                      <MiniStat label="Rate" value={item.rateAmount == null ? (item.negotiable ? 'Negotiable' : 'Not provided') : formatCurrency(item.rateAmount)} />
                      <MiniStat label="Jobs" value={String(item.provider.completedJobsCount)} />
                    </div>
                    {item.provider.portfolioUrls.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Previous work
                        </p>
                        <div className="space-y-1">
                          {item.provider.portfolioUrls.slice(0, 3).map((url) => (
                            <a key={url} href={url} className="block break-all text-xs text-primary underline">
                              View profile work
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    <ProviderTrustSignals signals={signals} />
                    <ProviderTrustNote marketplaceApproved={item.provider.verified} />
                    {selected ? (
                      <div className="rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                        Selected. We are asking this provider to confirm.
                      </div>
                    ) : (
                      <form action={selectShortlistProvider}>
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="requestId" value={jobRequest.id} />
                        <input type="hidden" name="shortlistItemId" value={item.id} />
                        <Button type="submit" className="w-full">
                          Select provider
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {jobRequest.status === 'SHORTLIST_READY' && (
            <div className="grid grid-cols-2 gap-2">
              <form action={askForMoreShortlistOptions}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="requestId" value={jobRequest.id} />
                <Button type="submit" variant="outline" className="w-full">
                  Ask for more options
                </Button>
              </form>
              <form action={cancelRequestAction}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="requestId" value={jobRequest.id} />
                <Button type="submit" variant="ghost" className="w-full text-destructive">
                  Cancel request
                </Button>
              </form>
            </div>
          )}
        </section>
      )}

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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
